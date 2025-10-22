import { Redis } from 'ioredis';
import { logger } from '../utils/logger';
import { findMatchingRule, shouldSuppressDuringMaintenance, getEffectiveRobotsRespect, getEffectiveLatencyThreshold } from './rulesService';
import { isUrlAllowed } from './allowListService';
import { isAllowedByRobotsTxt } from './robotsService';
import { generateFingerprint, generateTimeoutFingerprint, generateNetworkErrorFingerprint, generateHttpErrorFingerprint, generateLatencyFingerprint } from './fingerprintService';
import { checkDeduplication, recordFinding } from './deduplicationService';
import { recordFindingSuppressed, recordFingerprintDeduplication } from '../utils/metrics';

export interface SuppressionCheck {
  suppressed: boolean;
  reason?: string;
  fingerprint?: string;
}

/**
 * Check if a finding should be suppressed by rules engine
 * Returns { suppressed: true, reason, fingerprint } if suppressed
 */
export async function checkSuppression(
  redis: Redis,
  url: string,
  errorType: '5xx' | 'latency' | 'timeout' | 'network',
  statusCode?: number,
  errorMessage?: string,
  latencyMs?: number
): Promise<SuppressionCheck> {
  try {
    // Step 1: Check allow-list
    const urlAllowed = isUrlAllowed(url);
    if (!urlAllowed) {
      logger.debug(`[RulesEngine] URL not in allow-list: ${url}`);
      recordFindingSuppressed('allowlist');
      return {
        suppressed: true,
        reason: 'allowlist',
      };
    }

    // Step 2: Find matching rule
    const rule = findMatchingRule(url);
    logger.debug(`[RulesEngine] Matched rule: ${rule?.id || 'none'} for URL: ${url}`);

    // Step 3: Check maintenance window
    if (shouldSuppressDuringMaintenance(rule)) {
      logger.debug(`[RulesEngine] Suppressing during maintenance window for rule: ${rule?.id}`);
      recordFindingSuppressed('maintenance');
      return {
        suppressed: true,
        reason: 'maintenance',
      };
    }

    // Step 4: Check robots.txt (if enabled for this rule)
    const respectRobots = getEffectiveRobotsRespect(rule);
    if (respectRobots) {
      const robotsAllowed = await isAllowedByRobotsTxt(redis, url);
      if (!robotsAllowed) {
        logger.debug(`[RulesEngine] URL disallowed by robots.txt: ${url}`);
        recordFindingSuppressed('robots');
        return {
          suppressed: true,
          reason: 'robots',
        };
      }
    }

    // Step 5: Generate fingerprint based on error type
    let fingerprint: string;
    switch (errorType) {
      case '5xx':
        fingerprint = generateHttpErrorFingerprint(url, statusCode || 500);
        break;
      case 'latency':
        fingerprint = generateLatencyFingerprint(url, latencyMs || 0);
        break;
      case 'timeout':
        fingerprint = generateTimeoutFingerprint(url);
        break;
      case 'network':
        fingerprint = generateNetworkErrorFingerprint(url, errorMessage || 'NETWORK_ERROR');
        break;
      default:
        fingerprint = generateFingerprint(url, statusCode, errorMessage);
    }

    // Step 6: Check deduplication and cooldown
    const dedupResult = await checkDeduplication(redis, fingerprint, rule);
    if (dedupResult.suppressed) {
      logger.debug(
        `[RulesEngine] Finding suppressed by ${dedupResult.reason}: ${fingerprint.substring(0, 16)}...`
      );
      recordFindingSuppressed(dedupResult.reason || 'cooldown');
      return {
        suppressed: true,
        reason: dedupResult.reason,
        fingerprint,
      };
    }

    // Step 7: Record finding (not suppressed)
    const fingerprintData = await recordFinding(
      redis,
      fingerprint,
      url,
      rule,
      statusCode,
      errorMessage
    );

    // Record metrics
    if (fingerprintData.occurrenceCount === 1) {
      recordFingerprintDeduplication('new');
    } else {
      recordFingerprintDeduplication('updated');
    }

    logger.debug(
      `[RulesEngine] Finding allowed: ${fingerprint.substring(0, 16)}... (occurrence: ${fingerprintData.occurrenceCount})`
    );

    return {
      suppressed: false,
      fingerprint,
    };
  } catch (error) {
    logger.error(`[RulesEngine] Error checking suppression: ${error}`);
    // On error, allow the finding (fail open)
    return {
      suppressed: false,
      reason: 'error',
    };
  }
}

/**
 * Check if latency exceeds threshold for a URL
 */
export function shouldAlertLatency(url: string, latencyMs: number): boolean {
  const rule = findMatchingRule(url);
  const threshold = getEffectiveLatencyThreshold(rule);
  return latencyMs > threshold;
}
