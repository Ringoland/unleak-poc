import { Router } from 'express';
import { getRulesConfig } from '../../services/rulesService';
import { getAllowListPatterns, reloadAllowList } from '../../services/allowListService';
import { getAllCachedRobots, clearRobotsCache } from '../../services/robotsService';
import { getAllFingerprints, getCooldownStats } from '../../services/deduplicationService';
import { getRedisClient } from '../../config/redis';

const router: Router = Router();


router.get('/', async (_req, res) => {
  try {
    const redis = getRedisClient();

    // Get all rules engine data
    const [rulesConfig, allowListPatterns, robotsCache, fingerprints, cooldownStats] =
      await Promise.all([
        Promise.resolve(getRulesConfig()),
        Promise.resolve(getAllowListPatterns()),
        getAllCachedRobots(redis),
        getAllFingerprints(redis),
        getCooldownStats(redis),
      ]);

    res.json({
      rules: {
        defaults: rulesConfig.defaults,
        rulesCount: rulesConfig.rules.length,
        rules: rulesConfig.rules.map(rule => ({
          id: rule.id,
          pattern: rule.pattern,
          cooldownSeconds: rule.cooldownSeconds,
          latencyMsThreshold: rule.latencyMsThreshold,
          respectRobots: rule.respectRobots,
          maintenanceWindows: rule.maintenance?.length || 0,
          suppressDuringMaintenance: rule.suppressDuringMaintenance,
        })),
      },
      allowList: {
        patternsCount: allowListPatterns.length,
        patterns: allowListPatterns,
      },
      robotsCache: {
        cachedDomains: robotsCache.length,
        entries: robotsCache.map(entry => ({
          domain: entry.domain,
          disallowedPaths: entry.rules?.disallowedPaths?.length || 0,
          allowedPaths: entry.rules?.allowedPaths?.length || 0,
          crawlDelay: entry.rules?.crawlDelay,
          ttlSeconds: entry.ttl,
        })),
      },
      deduplication: {
        totalFingerprints: cooldownStats.totalFingerprints,
        activeCooldowns: cooldownStats.activeCooldowns,
        recentFingerprints: fingerprints.slice(0, 20).map(fp => ({
          fingerprint: fp.fingerprint.substring(0, 16) + '...',
          url: fp.url,
          occurrenceCount: fp.occurrenceCount,
          firstSeenAt: new Date(fp.firstSeenAt).toISOString(),
          lastSeenAt: new Date(fp.lastSeenAt).toISOString(),
          statusCode: fp.statusCode,
        })),
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to fetch rules status: ${errorMessage}` });
  }
});

/**
 * POST /admin/rules/reload-allowlist
 * Reload allow-list from file
 */
router.post('/reload-allowlist', (_req, res) => {
  try {
    reloadAllowList();
    res.json({
      message: 'Allow-list reloaded successfully',
      patternsCount: getAllowListPatterns().length,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to reload allow-list: ${errorMessage}` });
  }
});

/**
 * DELETE /admin/rules/robots-cache
 * Clear robots.txt cache for a domain or all domains
 */
router.delete('/robots-cache', async (req, res) => {
  try {
    const redis = getRedisClient();
    const { domain } = req.query;

    const deletedCount = await clearRobotsCache(redis, domain as string | undefined);

    res.json({
      message: domain
        ? `Cleared robots.txt cache for ${domain}`
        : 'Cleared all robots.txt cache',
      deletedCount,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to clear robots cache: ${errorMessage}` });
  }
});

/**
 * GET /admin/rules/fingerprints
 * Get all fingerprints with details
 */
router.get('/fingerprints', async (_req, res) => {
  try {
    const redis = getRedisClient();
    const fingerprints = await getAllFingerprints(redis);

    res.json({
      total: fingerprints.length,
      fingerprints: fingerprints.map(fp => ({
        fingerprint: fp.fingerprint,
        url: fp.url,
        occurrenceCount: fp.occurrenceCount,
        firstSeenAt: new Date(fp.firstSeenAt).toISOString(),
        lastSeenAt: new Date(fp.lastSeenAt).toISOString(),
        statusCode: fp.statusCode,
        errorMessage: fp.errorMessage,
      })),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to fetch fingerprints: ${errorMessage}` });
  }
});

export default router;
