import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { getBreakerService } from '../../services/breaker';
import { db } from '../../db';
import { runs } from '../../db/schema';
import { desc } from 'drizzle-orm';
import rulesRouter from './rules';

const router: Router = Router();

/**
 * GET /admin/breaker - Get current circuit breaker states for all targets
 * Returns state, failure counts, and recent outcomes for monitoring
 */
router.get('/breaker', async (_req: Request, res: Response) => {
  try {
    const breaker = getBreakerService();
    const stats = await breaker.getAllStats();

    return res.json({
      timestamp: new Date().toISOString(),
      breakerCount: stats.length,
      breakers: stats.map((s) => ({
        targetId: s.targetId,
        state: s.state,
        failureCount: s.failureCount,
        successCount: s.successCount,
        failureRate: s.failureRate,
        openedAt: s.openedAt,
        nextProbeAt: s.nextProbeAt,
        lastError: s.lastError,
        recentOutcomes: s.recentOutcomes || [], // Last 10 outcomes
        consecutiveFailures: s.consecutiveFailures,
      })),
    });
  } catch (error) {
    logger.error('[Admin] Error fetching breaker stats', {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to fetch breaker stats',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /admin/runs - Get all runs (admin view)
 * Optional query params: limit, status
 */
router.get('/runs', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || '50')), 200);
    const statusFilter = req.query.status ? String(req.query.status) : undefined;

    let query = db.select().from(runs).orderBy(desc(runs.createdAt)).limit(limit);

    const allRuns = await query;

    // Filter by status if provided
    const filteredRuns = statusFilter
      ? allRuns.filter((r) => r.status === statusFilter)
      : allRuns;

    return res.json({
      total: filteredRuns.length,
      limit,
      runs: filteredRuns,
    });
  } catch (error) {
    logger.error('[Admin] Error fetching runs', {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to fetch runs',
    });
  }
});

/**
 * GET /admin/runs/:id - Get detailed run information including findings
 */
router.get('/runs/:id', async (req: Request, res: Response) => {
  try {
    const runId = req.params.id;

    // This would need to join with findings table
    // For now, just return the run
    const { eq } = await import('drizzle-orm');
    const run = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);

    if (!run || run.length === 0) {
      return res.status(404).json({
        error: 'Run not found',
        id: runId,
      });
    }

    return res.json(run[0]);
  } catch (error) {
    logger.error('[Admin] Error fetching run details', {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to fetch run details',
    });
  }
});

/**
 * POST /admin/breaker/reset - Reset circuit breaker state for a specific target
 */
router.post('/breaker/reset', async (req: Request, res: Response) => {
  try {
    const { targetId } = req.body;

    if (!targetId) {
      return res.status(400).json({
        error: 'targetId is required',
      });
    }

    const breaker = getBreakerService();
    
    // Reset the breaker by clearing its state
    await breaker.reset(targetId);

    logger.info(`[Admin] Breaker reset for target: ${targetId}`);

    return res.json({
      ok: true,
      targetId,
      message: 'Breaker state reset',
      resetAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('[Admin] Error resetting breaker', {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to reset breaker',
    });
  }
});

router.use('/rules', rulesRouter);

export default router;
