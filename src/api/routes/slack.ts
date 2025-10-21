import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { getRedisClient } from '../../config/redis';

const router: Router = Router();

// In-memory muted findings store (could be moved to Redis/DB for persistence)
const mutedFindings = new Set<string>();

// POST /api/slack/actions - Handle Slack action button clicks
router.post('/actions', async (req: Request, res: Response) => {
  try {
    const { act, findingId } = req.query;

    if (!act || !findingId) {
      return res.status(400).json({
        error: 'Missing required query parameters',
        required: ['act', 'findingId'],
      });
    }

    const action = String(act);
    const finding = String(findingId);

    logger.info(`[Slack] Action received: ${action} for finding ${finding}`);

    switch (action) {
      case 'ack': {
        // Acknowledge the alert
        const redis = getRedisClient();
        const ackKey = `slack:ack:${finding}`;
        
        await redis.setex(ackKey, 86400, new Date().toISOString()); // 24 hour expiry
        
        logger.info(`[Slack] Finding ${finding} acknowledged`);
        
        return res.json({
          ok: true,
          action: 'ack',
          findingId: finding,
          message: 'Alert acknowledged',
          acknowledgedAt: new Date().toISOString(),
        });
      }

      case 'mute': {
        // Mute further alerts for this finding
        mutedFindings.add(finding);
        
        const redis = getRedisClient();
        const muteKey = `slack:mute:${finding}`;
        
        // Mute for 1 hour
        await redis.setex(muteKey, 3600, new Date().toISOString());
        
        logger.info(`[Slack] Finding ${finding} muted for 1 hour`);
        
        return res.json({
          ok: true,
          action: 'mute',
          findingId: finding,
          message: 'Alerts muted for 1 hour',
          mutedAt: new Date().toISOString(),
          mutedUntil: new Date(Date.now() + 3600000).toISOString(),
        });
      }

      case 'unmute': {
        // Unmute alerts for this finding
        mutedFindings.delete(finding);
        
        const redis = getRedisClient();
        const muteKey = `slack:mute:${finding}`;
        
        await redis.del(muteKey);
        
        logger.info(`[Slack] Finding ${finding} unmuted`);
        
        return res.json({
          ok: true,
          action: 'unmute',
          findingId: finding,
          message: 'Alerts unmuted',
          unmutedAt: new Date().toISOString(),
        });
      }

      default:
        return res.status(400).json({
          error: 'Invalid action',
          action,
          validActions: ['ack', 'mute', 'unmute'],
        });
    }
  } catch (error) {
    logger.error('[Slack] Error handling action', {
      error: error instanceof Error ? error.message : String(error),
    });
    
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET /api/slack/actions/status - Check if a finding is muted or acknowledged
router.get('/actions/status', async (req: Request, res: Response) => {
  try {
    const { findingId } = req.query;

    if (!findingId) {
      return res.status(400).json({
        error: 'Missing findingId query parameter',
      });
    }

    const finding = String(findingId);
    const redis = getRedisClient();

    const [ackTime, muteTime] = await Promise.all([
      redis.get(`slack:ack:${finding}`),
      redis.get(`slack:mute:${finding}`),
    ]);

    return res.json({
      findingId: finding,
      isAcknowledged: !!ackTime,
      acknowledgedAt: ackTime,
      isMuted: !!muteTime,
      mutedAt: muteTime,
    });
  } catch (error) {
    logger.error('[Slack] Error checking status', {
      error: error instanceof Error ? error.message : String(error),
    });
    
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});

/**
 * Helper function to check if a finding is muted
 * Can be imported and used before sending Slack alerts
 */
export async function isFindingMuted(findingId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const muteKey = `slack:mute:${findingId}`;
    const muteTime = await redis.get(muteKey);
    return !!muteTime;
  } catch (error) {
    logger.error('[Slack] Error checking mute status', { findingId, error });
    return false; // Default to not muted on error
  }
}

export default router;
