import { Router, Request, Response } from 'express';
import { getRedisClient } from '../../config/redis';
import { recordReverifyRequest } from '../../utils/metrics';

const router: Router = Router();

// POST /api/findings/:id/reverify - Reverify a finding
router.post('/:id/reverify', async (req: Request, res: Response) => {
  const findingId = req.params.id;
  const idempotencyKey = req.headers['idempotency-key'] as string;

  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header required' });
  }

  try {
    const redis = getRedisClient();
    const ttl = 120; // 120 seconds TTL

    // Check if this idempotency key was already used
    const keyName = `reverify:${idempotencyKey}`;
    const existing = await redis.get(keyName);

    if (existing) {
      const ttlSeconds = await redis.ttl(keyName);
      recordReverifyRequest('duplicate_ttl');
      return res.json({
        id: findingId,
        reverifyStatus: 'duplicate_ttl',
        error: 'duplicate_ttl',
        ttlSecondsRemaining: Math.max(0, ttlSeconds),
      });
    }

    // Check rate limit for this finding
    const rateLimitKey = `reverify:rate:${findingId}`;
    const requestCount = await redis.incr(rateLimitKey);

    if (requestCount === 1) {
      await redis.expire(rateLimitKey, 3600); // 1 hour window
    }

    const rateLimit = 5; // 5 requests per hour
    if (requestCount > rateLimit) {
      recordReverifyRequest('rate_limited');
      return res.status(429).json({
        id: findingId,
        reverifyStatus: 'rate_limited',
      });
    }

    // Store idempotency key
    await redis.setex(`reverify:${idempotencyKey}`, ttl, findingId);

    // Process reverification (placeholder)
    recordReverifyRequest('accepted');
    return res.json({
      id: findingId,
      reverifyStatus: 'accepted',
    });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
