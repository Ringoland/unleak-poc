import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { getRedisClient } from '../../config/redis';
import { reverifyFinding } from '../../services/reverifyService';
import { sendSlackMessage } from '../../services/slackService';

const router: Router = Router();

// POST /api/slack/actions - Handle Slack action button clicks
// Accepts { action: 'reverify' | 'suppress24h', findingId: string }
router.post('/actions', async (req: Request, res: Response) => {
  try {
    const { action, findingId } = req.body;

    if (!action || !findingId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: action and findingId',
      });
    }

    logger.info(`[Slack] Action received: ${action} for finding ${findingId}`);

    switch (action) {
      case 'reverify': {
        // Call Re-verify API
        const result = await reverifyFinding({
          findingId,
          ip: req.ip,
          userAgent: req.get('user-agent'),
          source: 'slack',
        });

        // Update Slack thread with result
        let message = '';
        if (result.ok && result.result === 'ok') {
          message = `✅ Re-verify request accepted for finding \`${findingId}\`\nJob ID: \`${result.jobId}\`\nRemaining attempts: ${result.remainingAttempts}/5 per hour`;
        } else if (result.result === 'duplicate') {
          message = `ℹ️ Re-verify already in progress for finding \`${findingId}\`\nJob ID: \`${result.jobId}\` (duplicate within 120s window)`;
        } else if (result.result === 'rate_limited') {
          message = `⚠️ Rate limit exceeded for finding \`${findingId}\`\nMax 5 requests per hour. Please try again later.`;
        } else {
          message = `❌ Re-verify failed for finding \`${findingId}\`: ${result.message}`;
        }

        // Send update to Slack
        await sendSlackMessage(message);

        return res.json({
          ok: result.ok,
          action: 'reverify',
          findingId,
          result: result.result,
          jobId: result.jobId,
          message,
        });
      }

      case 'suppress24h': {
        // Insert/update a rule for the finding's fingerprint with 24h TTL
        const redis = getRedisClient();
        const suppressKey = `suppress:${findingId}`;
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        
        await redis.setex(suppressKey, 86400, expiresAt); // 24 hours
        
        logger.info(`[Slack] Finding ${findingId} suppressed for 24h until ${expiresAt}`);
        
        // Send confirmation to Slack
        const message = `🔇 Finding \`${findingId}\` suppressed for 24 hours\nExpires: ${expiresAt}`;
        await sendSlackMessage(message);
        
        return res.json({
          ok: true,
          action: 'suppress24h',
          findingId,
          message: 'Finding suppressed for 24 hours',
          expiresAt,
        });
      }

      default:
        return res.status(400).json({
          ok: false,
          error: 'Invalid action',
          action,
          validActions: ['reverify', 'suppress24h'],
        });
    }
  } catch (error) {
    logger.error('[Slack] Error handling action', {
      error: error instanceof Error ? error.message : String(error),
    });
    
    return res.status(500).json({
      ok: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Helper function to check if a finding is suppressed
 * Can be imported and used before sending Slack alerts
 */
export async function isFindingSuppressed(findingId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const suppressKey = `suppress:${findingId}`;
    const suppressed = await redis.get(suppressKey);
    return !!suppressed;
  } catch (error) {
    logger.error('[Slack] Error checking suppress status', { findingId, error });
    return false; // Default to not suppressed on error
  }
}

export default router;
