import { Router, Request, Response } from 'express';
import { reverifyFinding, getReverifyAttempts } from '../../services/reverifyService';
import { logger } from '../../utils/logger';
import { createSafeLogMetadata } from '../../utils/redact';

const router: Router = Router();

// UUID v4 regex pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.post('/:id/reverify', async (req: Request, res: Response) => {
  const findingId = req.params.id;

  // Validate UUID format
  if (!UUID_REGEX.test(findingId)) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid finding ID format',
      message: 'Finding ID must be a valid UUID',
    });
  }

  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];
  const source = req.body?.source || 'api';

  try {
    const result = await reverifyFinding({
      findingId,
      ip,
      userAgent,
      source: source === 'slack' ? 'slack' : 'api',
    });

    // Log with redacted metadata
    logger.info('reverify.request', createSafeLogMetadata({
      findingId,
      result: result.result,
      ip,
      userAgent,
      source,
    }));

    if (result.result === 'not_found') {
      return res.status(404).json(result);
    }

    if (result.result === 'rate_limited') {
      return res.status(429).json(result);
    }

    return res.json(result);
  } catch (error) {
    logger.error('reverify.endpoint_error', createSafeLogMetadata({ 
      error: error instanceof Error ? error.message : String(error),
      findingId,
    }));
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

  // Validate UUID format
  if (!UUID_REGEX.test(findingId)) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid finding ID format',
      message: 'Finding ID must be a valid UUID',
    });
  }

  try {
    const attempts = await getReverifyAttempts(findingId);
    return res.json({
      findingId,
      attempts,
      total: attempts.length,
    });
  } catch (error) {
    logger.error('reverify.get_attempts_error', createSafeLogMetadata({ 
      error: error instanceof Error ? error.message : String(error),
      findingId,
    }));
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
