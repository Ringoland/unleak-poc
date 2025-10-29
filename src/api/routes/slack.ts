import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { getRedisClient } from '../../config/redis';
import { reverifyFinding } from '../../services/reverifyService';
import { sendSlackMessage } from '../../services/slackService';
import { config } from '../../config';
import { db } from '../../db';
import { findings } from '../../db/schema';
import { eq } from 'drizzle-orm';

const router: Router = Router();

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Handle Slack action requests (both GET and POST)
 * GET: Link buttons from Slack alerts
 * POST: Interactive components (deprecated but kept for backwards compatibility)
 */
async function handleSlackAction(req: Request, res: Response) {
  try {
    // Extract parameters from query (GET) or body (POST)
    const action = (req.query.action || req.body?.action) as string;
    const findingId = (req.query.findingId || req.body?.findingId) as string;
    const token = (req.query.t || req.body?.t) as string;

    // Validate token (PoC security)
    if (!token || token !== config.slackActionToken) {
      logger.warn('[Slack] Unauthorized action attempt', {
        action,
        findingId,
        hasToken: !!token,
        ip: req.ip,
      });
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized',
        message: 'Invalid or missing action token',
      });
    }

    // Validate required fields
    if (!action || !findingId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: action and findingId',
      });
    }

    // Validate action enum
    if (action !== 'reverify' && action !== 'suppress24h') {
      return res.status(400).json({
        ok: false,
        error: 'Invalid action',
        action,
        validActions: ['reverify', 'suppress24h'],
      });
    }

    // Validate findingId is a valid UUID
    if (!UUID_REGEX.test(findingId)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid findingId',
        message: 'findingId must be a valid UUID',
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

        // For GET requests, return HTML response
        if (req.method === 'GET') {
          return res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Re-verify Action</title></head>
            <body style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
              <h2>✅ Re-verify Request</h2>
              <p>${message.replace(/`/g, '<code>').replace(/\n/g, '<br>')}</p>
              <p><a href="javascript:window.close()">Close this window</a></p>
            </body>
            </html>
          `);
        }

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
        // Resolve fingerprint from findingId
        const finding = await db.query.findings.findFirst({
          where: eq(findings.id, findingId),
          columns: {
            fingerprint: true,
            url: true,
          },
        });

        if (!finding || !finding.fingerprint) {
          logger.warn(`[Slack] Finding ${findingId} not found or has no fingerprint`);
          const errorMsg = 'Finding not found or has no fingerprint';
          
          if (req.method === 'GET') {
            return res.send(`
              <!DOCTYPE html>
              <html>
              <head><title>Suppress Action</title></head>
              <body style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
                <h2>❌ Error</h2>
                <p>${errorMsg}</p>
                <p><a href="javascript:window.close()">Close this window</a></p>
              </body>
              </html>
            `);
          }

          return res.status(404).json({
            ok: false,
            error: errorMsg,
          });
        }

        // Suppress by fingerprint (not findingId)
        const redis = getRedisClient();
        const suppressKey = `suppress:fp:${finding.fingerprint}`;
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        
        await redis.setex(suppressKey, 86400, expiresAt); // 24 hours
        
        logger.info(`[Slack] Fingerprint ${finding.fingerprint.substring(0, 16)}... suppressed for 24h until ${expiresAt}`);
        
        // Send confirmation to Slack
        const message = `🔇 Finding \`${findingId}\` (fingerprint \`${finding.fingerprint.substring(0, 16)}...\`) suppressed for 24 hours\nExpires: ${expiresAt}\nURL: ${finding.url}`;
        await sendSlackMessage(message);

        // For GET requests, return HTML response
        if (req.method === 'GET') {
          return res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Suppress Action</title></head>
            <body style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
              <h2>🔇 Suppression Activated</h2>
              <p>Finding <code>${findingId}</code> has been suppressed for 24 hours.</p>
              <p>Fingerprint: <code>${finding.fingerprint.substring(0, 16)}...</code></p>
              <p>Expires: ${expiresAt}</p>
              <p><a href="javascript:window.close()">Close this window</a></p>
            </body>
            </html>
          `);
        }
        
        return res.json({
          ok: true,
          action: 'suppress24h',
          findingId,
          fingerprint: finding.fingerprint,
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
    
    if (req.method === 'GET') {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
          <h2>❌ Error</h2>
          <p>An error occurred processing your request.</p>
          <p><a href="javascript:window.close()">Close this window</a></p>
        </body>
        </html>
      `);
    }
    
    return res.status(500).json({
      ok: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// GET and POST /api/slack/actions
router.get('/actions', handleSlackAction);
router.post('/actions', handleSlackAction);

/**
 * Helper function to check if a fingerprint is suppressed
 * Can be imported and used before sending Slack alerts
 */
export async function isFingerprintSuppressed(fingerprint: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const suppressKey = `suppress:fp:${fingerprint}`;
    const suppressed = await redis.get(suppressKey);
    return !!suppressed;
  } catch (error) {
    logger.error('[Slack] Error checking suppress status', { fingerprint, error });
    return false; // Default to not suppressed on error
  }
}

/**
 * Helper function to check if a finding is suppressed (by resolving fingerprint)
 * @deprecated Use isFingerprintSuppressed() directly when you have the fingerprint
 */
export async function isFindingSuppressed(findingId: string): Promise<boolean> {
  try {
    const finding = await db.query.findings.findFirst({
      where: eq(findings.id, findingId),
      columns: {
        fingerprint: true,
      },
    });

    if (!finding || !finding.fingerprint) {
      return false;
    }

    return isFingerprintSuppressed(finding.fingerprint);
  } catch (error) {
    logger.error('[Slack] Error checking suppress status', { findingId, error });
    return false; // Default to not suppressed on error
  }
}

export default router;
