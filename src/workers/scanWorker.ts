import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../config/redis';
import { db } from '../db';
import { findings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { addRenderJob } from '../services/queueService';
import { findMatchingRule, getEffectiveCooldown, shouldSuppressDuringMaintenance } from '../services/rulesService';
import { isUrlAllowed } from '../services/allowListService';
import { generateFingerprint } from '../services/fingerprintService';
import { checkDeduplication, recordFinding } from '../services/deduplicationService';
import { isAllowedByRobotsTxt } from '../services/robotsService';
import { logger } from '../utils/logger';

export interface ScanJobData {
  url: string;
  findingId: string;
  scanType?: string;
}

export function createScanWorker() {
  const connection = getRedisClient();

  const worker = new Worker<ScanJobData>(
    'scan-queue',
    async (job: Job<ScanJobData>) => {
      logger.info(`Processing scan job ${job.id} for URL: ${job.data.url}`);

      try {
        // Update finding status to scanning
        await db
          .update(findings)
          .set({
            status: 'scanning',
            updatedAt: new Date(),
          })
          .where(eq(findings.id, job.data.findingId));

        logger.info(`[SCAN] Finding ${job.data.findingId} status updated to scanning`);

        // Perform the scan
        const scanResult = await performScan(job.data);

        // Queue render job only if scan was not suppressed
        if (!scanResult.suppressed) {
          try {
            const renderJob = await addRenderJob({
              findingId: job.data.findingId,
              url: job.data.url,
              options: {
                timeout: 30000,
                waitUntil: 'networkidle',
                captureHAR: true,
              },
            });

            logger.info(`[SCAN] Queued render job ${renderJob.id} for finding ${job.data.findingId}`);
          } catch (error) {
            logger.error(`[SCAN] Failed to queue render job for finding ${job.data.findingId}:`, error);
          }
        } else {
          logger.info(`[SCAN] Skipping render job for suppressed finding ${job.data.findingId}`);
        }

        return { status: 'completed', findingId: job.data.findingId };
      } catch (error) {
        logger.error(`Scan job ${job.id} failed:`, error);
        throw error;
      }
    },
    { connection }
  );

  worker.on('completed', (job) => {
    logger.info(`Scan job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Scan job ${job?.id} failed:`, err);
  });

  return worker;
}

interface ScanResult {
  suppressed: boolean;
  reason?: string;
}

async function performScan(data: ScanJobData): Promise<ScanResult> {
  const redis = getRedisClient();
  logger.info(`[SCAN] Starting scan for ${data.url}`);

  try {
    // Step 1: Check allow-list
    if (!isUrlAllowed(data.url)) {
      logger.warn(`[SCAN] URL ${data.url} not in allow-list, skipping`);
      await db
        .update(findings)
        .set({
          status: 'suppressed',
          metadata: { suppressReason: 'not_in_allowlist' },
          updatedAt: new Date(),
        })
        .where(eq(findings.id, data.findingId));
      return { suppressed: true, reason: 'not_in_allowlist' };
    }

    // Step 2: Find matching rule
    const rule = findMatchingRule(data.url);
    logger.info(`[SCAN] Matched rule: ${rule?.id || 'default-web'} for ${data.url}`);

    // Step 3: Check maintenance window
    if (shouldSuppressDuringMaintenance(rule)) {
      logger.warn(`[SCAN] URL ${data.url} in maintenance window, suppressing`);
      await db
        .update(findings)
        .set({
          status: 'suppressed',
          metadata: { suppressReason: 'maintenance_window' },
          updatedAt: new Date(),
        })
        .where(eq(findings.id, data.findingId));
      return { suppressed: true, reason: 'maintenance_window' };
    }

    // Step 4: Check robots.txt (if configured)
    try {
      const isAllowed = await isAllowedByRobotsTxt(redis, data.url);
      
      if (!isAllowed) {
        logger.warn(`[SCAN] URL ${data.url} disallowed by robots.txt, suppressing`);
        await db
          .update(findings)
          .set({
            status: 'suppressed',
            metadata: { suppressReason: 'robots_txt_disallow' },
            updatedAt: new Date(),
          })
          .where(eq(findings.id, data.findingId));
        return { suppressed: true, reason: 'robots_txt_disallow' };
      }
    } catch (error) {
      logger.warn(`[SCAN] Failed to check robots.txt for ${data.url}:`, error);
      // Continue anyway
    }

    // Step 5: Generate fingerprint
    const fingerprint = generateFingerprint(data.url, 200, undefined);

    logger.info(`[SCAN] Generated fingerprint: ${fingerprint}`);

    // Step 6: Check deduplication/cooldown
    const cooldownSeconds = getEffectiveCooldown(rule);
    const deduplicationResult = await checkDeduplication(redis, fingerprint, rule);

    if (deduplicationResult.suppressed) {
      logger.warn(`[SCAN] Fingerprint ${fingerprint} within cooldown (${cooldownSeconds}s), suppressing`);
      await db
        .update(findings)
        .set({
          status: 'suppressed',
          metadata: { 
            suppressReason: 'cooldown',
            fingerprint,
            cooldownSeconds,
          },
          fingerprint,
          updatedAt: new Date(),
        })
        .where(eq(findings.id, data.findingId));
      return { suppressed: true, reason: 'cooldown' };
    }

    // Step 7: Record this finding
    await recordFinding(redis, fingerprint, data.url, rule, 200, undefined);

    // Step 8: Update finding with fingerprint
    await db
      .update(findings)
      .set({
        fingerprint,
        metadata: { 
          ruleId: rule?.id || 'default-web',
          cooldownSeconds,
        },
        updatedAt: new Date(),
      })
      .where(eq(findings.id, data.findingId));

    logger.info(`[SCAN] Scan completed successfully for ${data.url}`);
    return { suppressed: false };
  } catch (error) {
    logger.error(`[SCAN] Scan failed for ${data.url}:`, error);
    throw error;
  }
}
