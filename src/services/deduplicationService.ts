import { Redis } from 'ioredis';
import { logger } from '../utils/logger';
import { getEffectiveCooldown } from './rulesService';
import type { Rule } from './rulesService';

const FINGERPRINT_KEY_PREFIX = 'fingerprint:';
const COOLDOWN_KEY_PREFIX = 'cooldown:';

export interface FingerprintData {
  fingerprint: string;
  url: string;
  firstSeenAt: number; // Unix timestamp
  lastSeenAt: number; // Unix timestamp
  occurrenceCount: number;
  statusCode?: number;
  errorMessage?: string;
}

/**
 * Check if fingerprint exists and is within cooldown period
 */
export async function isWithinCooldown(
  redis: Redis,
  fingerprint: string,
  _rule: Rule | null
): Promise<boolean> {
  const cooldownKey = `${COOLDOWN_KEY_PREFIX}${fingerprint}`;
  const exists = await redis.exists(cooldownKey);
  
  if (exists) {
    const ttl = await redis.ttl(cooldownKey);
    logger.debug(`[Dedup] Fingerprint ${fingerprint.substring(0, 16)}... is in cooldown (${ttl}s remaining)`);
    return true;
  }
  
  return false;
}

/**
 * Get existing fingerprint data
 */
export async function getFingerprint(
  redis: Redis,
  fingerprint: string
): Promise<FingerprintData | null> {
  const key = `${FINGERPRINT_KEY_PREFIX}${fingerprint}`;
  const data = await redis.get(key);
  
  if (!data) {
    return null;
  }
  
  try {
    return JSON.parse(data) as FingerprintData;
  } catch (error) {
    logger.error(`[Dedup] Failed to parse fingerprint data: ${error}`);
    return null;
  }
}

/**
 * Store or update fingerprint data
 */
export async function storeFingerprint(
  redis: Redis,
  fingerprint: string,
  url: string,
  statusCode?: number,
  errorMessage?: string
): Promise<FingerprintData> {
  const key = `${FINGERPRINT_KEY_PREFIX}${fingerprint}`;
  const now = Date.now();
  
  // Get existing data or create new
  const existing = await getFingerprint(redis, fingerprint);
  
  const data: FingerprintData = existing
    ? {
        ...existing,
        lastSeenAt: now,
        occurrenceCount: existing.occurrenceCount + 1,
      }
    : {
        fingerprint,
        url,
        firstSeenAt: now,
        lastSeenAt: now,
        occurrenceCount: 1,
        statusCode,
        errorMessage,
      };
  
  // Store fingerprint data (persist indefinitely for tracking)
  await redis.set(key, JSON.stringify(data));
  
  logger.debug(
    `[Dedup] ${existing ? 'Updated' : 'Created'} fingerprint ${fingerprint.substring(0, 16)}... (count: ${data.occurrenceCount})`
  );
  
  return data;
}

/**
 * Set cooldown for a fingerprint
 */
export async function setCooldown(
  redis: Redis,
  fingerprint: string,
  rule: Rule | null
): Promise<void> {
  const cooldownSeconds = getEffectiveCooldown(rule);
  const cooldownKey = `${COOLDOWN_KEY_PREFIX}${fingerprint}`;
  
  // Set cooldown marker with expiration
  await redis.setex(cooldownKey, cooldownSeconds, Date.now().toString());
  
  logger.debug(
    `[Dedup] Set cooldown for fingerprint ${fingerprint.substring(0, 16)}... (${cooldownSeconds}s)`
  );
}

/**
 * Check if finding should be suppressed due to deduplication
 * Returns { suppressed: boolean, reason?: string, data?: FingerprintData }
 */
export async function checkDeduplication(
  redis: Redis,
  fingerprint: string,
  rule: Rule | null
): Promise<{ suppressed: boolean; reason?: string; data?: FingerprintData }> {
  // Check if within cooldown
  if (await isWithinCooldown(redis, fingerprint, rule)) {
    const data = await getFingerprint(redis, fingerprint);
    return {
      suppressed: true,
      reason: 'cooldown',
      data: data || undefined,
    };
  }
  
  return { suppressed: false };
}

/**
 * Record a new finding occurrence
 * Updates fingerprint data and sets cooldown
 */
export async function recordFinding(
  redis: Redis,
  fingerprint: string,
  url: string,
  rule: Rule | null,
  statusCode?: number,
  errorMessage?: string
): Promise<FingerprintData> {
  // Store/update fingerprint
  const data = await storeFingerprint(redis, fingerprint, url, statusCode, errorMessage);
  
  // Set cooldown period
  await setCooldown(redis, fingerprint, rule);
  
  return data;
}

/**
 * Get all fingerprints (for admin endpoint)
 */
export async function getAllFingerprints(redis: Redis): Promise<FingerprintData[]> {
  const keys = await redis.keys(`${FINGERPRINT_KEY_PREFIX}*`);
  const fingerprints: FingerprintData[] = [];
  
  for (const key of keys) {
    const data = await redis.get(key);
    if (data) {
      try {
        fingerprints.push(JSON.parse(data));
      } catch (error) {
        logger.warn(`[Dedup] Failed to parse fingerprint data for key ${key}`);
      }
    }
  }
  
  // Sort by lastSeenAt descending
  return fingerprints.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

/**
 * Get cooldown statistics (for admin endpoint)
 */
export async function getCooldownStats(redis: Redis): Promise<{
  activeCooldowns: number;
  totalFingerprints: number;
}> {
  const [cooldownKeys, fingerprintKeys] = await Promise.all([
    redis.keys(`${COOLDOWN_KEY_PREFIX}*`),
    redis.keys(`${FINGERPRINT_KEY_PREFIX}*`),
  ]);
  
  return {
    activeCooldowns: cooldownKeys.length,
    totalFingerprints: fingerprintKeys.length,
  };
}
