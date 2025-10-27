import { Router, Request, Response } from 'express';
import { reverifyFinding, getReverifyAttempts } from '../../services/reverifyService';
import { logger } from '../../utils/logger';

const router: Router = Router();

/**
 * POST /api/findings/:id/reverify
 * Reverify a finding by re-scanning the URL
 * Implements idempotency (120s TTL) and rate limiting (5/hour)
 */
router.post('/:id/reverify', async (req: Request, res: Response) => {
  const findingId = req.params.id;
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];
  const source = req.body.source || 'api';

  try {
    const result = await reverifyFinding({
      findingId,
      ip,
      userAgent,
      source: source === 'slack' ? 'slack' : 'api',
    });

    if (result.result === 'not_found') {
      return res.status(404).json(result);
    }

    if (result.result === 'rate_limited') {
      return res.status(429).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('reverify.endpoint_error', { error, findingId });
    return res.status(500).json({
      ok: false,
      result: 'error',
      message: 'Internal server error',
    });
  }
});

/**
 * GET /api/findings/:id/reverify-attempts
 * Get all reverify attempts for a finding
 */
router.get('/:id/reverify-attempts', async (req: Request, res: Response) => {
  const findingId = req.params.id;

  try {
    const attempts = await getReverifyAttempts(findingId);
    return res.json({
      findingId,
      attempts,
      total: attempts.length,
    });
  } catch (error) {
    logger.error('reverify.get_attempts_error', { error, findingId });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
