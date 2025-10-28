import { db } from '../db';
import { findings, reverifyAttempts, NewReverifyAttempt } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { recordReverifyRequest } from '../utils/metrics';
import { randomUUID } from 'crypto';
import { createSafeLogMetadata } from '../utils/redact';

const IDEMPOTENCY_TTL_SECONDS = 120;
const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour
const RATE_LIMIT_MAX_REQUESTS = 5;

export interface ReverifyRequest {
  findingId: string;
  ip?: string;
  userAgent?: string;
  source: 'slack' | 'api';
}

export interface ReverifyResponse {
  ok: boolean;
  result: 'ok' | 'duplicate' | 'rate_limited' | 'not_found';
  jobId?: string;
  message?: string;
  remainingAttempts?: number;
}

/**
 * Check if a reverify request is a duplicate within the idempotency window
 */
async function checkIdempotency(findingId: string): Promise<string | null> {
  try {
    const redis = getRedisClient();
    const key = `reverify:idempotency:${findingId}`;
    const existingJobId = await redis.get(key);
    return existingJobId;
  } catch (error) {
    logger.error('reverify.idempotency_check_failed', createSafeLogMetadata({ 
      error: error instanceof Error ? error.message : String(error),
      findingId,
    }));
    return null;
  }
}

/**
 * Set idempotency lock for a finding
 */
async function setIdempotency(findingId: string, jobId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const key = `reverify:idempotency:${findingId}`;
    await redis.setex(key, IDEMPOTENCY_TTL_SECONDS, jobId);
  } catch (error) {
    logger.error('reverify.idempotency_set_failed', createSafeLogMetadata({ 
      error: error instanceof Error ? error.message : String(error),
      findingId,
      jobId,
    }));
  }
}

/**
 * Check rate limit for a finding
 * Spec: Allow ≤5 requests per hour (allow 1-5, block 6th+)
 * Returns remaining attempts after this request, or -1 if rate limited
 */
async function checkRateLimit(findingId: string): Promise<number> {
  try {
    const redis = getRedisClient();
    const key = `reverify:count:${findingId}`;
    
    // Get current count BEFORE incrementing
    const currentCount = parseInt((await redis.get(key)) || '0', 10);
    
    // Check if already at limit (5 requests already made)
    if (currentCount >= RATE_LIMIT_MAX_REQUESTS) {
      return -1; // Rate limited
    }
    
    // Increment and set expiry
    const newCount = await redis.incr(key);
    
    // Set expiry on first increment
    if (newCount === 1) {
      await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }

    const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - newCount);
    return remaining;
  } catch (error) {
    logger.error('reverify.rate_limit_check_failed', createSafeLogMetadata({ 
      error: error instanceof Error ? error.message : String(error),
      findingId,
    }));
    // Fail open - allow request if Redis fails
    return RATE_LIMIT_MAX_REQUESTS;
  }
}

/**
 * Record a reverify attempt in the database
 */
async function recordAttempt(attempt: NewReverifyAttempt): Promise<void> {
  try {
    await db.insert(reverifyAttempts).values(attempt);
  } catch (error) {
    logger.error('reverify.record_attempt_failed', createSafeLogMetadata({ 
      error: error instanceof Error ? error.message : String(error),
      attempt,
    }));
  }
}

/**
 * Reverify a finding by re-scanning the URL
 * Implements idempotency and rate limiting
 */
export async function reverifyFinding(request: ReverifyRequest): Promise<ReverifyResponse> {
  const { findingId, ip, userAgent, source } = request;
  const startTime = Date.now();

  try {
    // Check if finding exists
    const [finding] = await db
      .select()
      .from(findings)
      .where(eq(findings.id, findingId))
      .limit(1);

    if (!finding) {
      logger.warn('reverify.not_found', createSafeLogMetadata({ findingId }));
      recordReverifyRequest('not_found', Date.now() - startTime);
      return {
        ok: false,
        result: 'not_found',
        message: 'Finding not found',
      };
    }

    // Check idempotency - duplicate request within 120s window
    const existingJobId = await checkIdempotency(findingId);
    if (existingJobId) {
      logger.info('reverify.duplicate', createSafeLogMetadata({ findingId, existingJobId }));
      
      await recordAttempt({
        findingId,
        jobId: existingJobId,
        ip,
        userAgent,
        source,
        result: 'duplicate',
      });

      recordReverifyRequest('duplicate', Date.now() - startTime);
      return {
        ok: true,
        result: 'duplicate',
        jobId: existingJobId,
        message: 'Request already in progress (duplicate within 120s window)',
      };
    }

    // Check rate limit - max 5 per hour (allow 1-5, block 6+)
    const remaining = await checkRateLimit(findingId);
    if (remaining === -1) {
      logger.warn('reverify.rate_limited', createSafeLogMetadata({ findingId }));
      
      await recordAttempt({
        findingId,
        ip,
        userAgent,
        source,
        result: 'rate_limited',
      });

      recordReverifyRequest('rate_limited', Date.now() - startTime);
      return {
        ok: false,
        result: 'rate_limited',
        message: 'Rate limit exceeded (max 5 requests per hour)',
        remainingAttempts: 0,
      };
    }

    // Generate job ID and set idempotency lock
    const jobId = randomUUID();
    await setIdempotency(findingId, jobId);

    // Record the attempt
    await recordAttempt({
      findingId,
      jobId,
      ip,
      userAgent,
      source,
      result: 'ok',
    });

    // TODO: Enqueue re-scan job to the scan queue
    // For now, we'll log the intent
    logger.info('reverify.ok', createSafeLogMetadata({
      findingId,
      jobId,
      url: finding.url,
      source,
      remainingAttempts: remaining,
    }));

    recordReverifyRequest('ok', Date.now() - startTime);
    return {
      ok: true,
      result: 'ok',
      jobId,
      message: 'Re-verify request accepted',
      remainingAttempts: remaining,
    };
  } catch (error) {
    logger.error('reverify.error', createSafeLogMetadata({ 
      error: error instanceof Error ? error.message : String(error),
      findingId,
    }));
    recordReverifyRequest('error', Date.now() - startTime);
    throw error;
  }
}

/**
 * Get reverify attempts for a finding
 */
export async function getReverifyAttempts(findingId: string) {
  try {
    const attempts = await db
      .select()
      .from(reverifyAttempts)
      .where(eq(reverifyAttempts.findingId, findingId))
      .orderBy(reverifyAttempts.requestedAt);

    return attempts;
  } catch (error) {
    logger.error('reverify.get_attempts_failed', createSafeLogMetadata({ 
      error: error instanceof Error ? error.message : String(error),
      findingId,
    }));
    return [];
  }
}
