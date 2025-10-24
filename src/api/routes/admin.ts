import { Router, Request, Response } from 'express';
import path from 'path';
import ejs from 'ejs';
import fs from 'fs/promises';
import { logger } from '../../utils/logger';
import { getBreakerService } from '../../services/breaker';
import { db } from '../../db';
import { runs, findings, artifacts } from '../../db/schema';
import { desc } from 'drizzle-orm';
import rulesRouter from './rules';

const router: Router = Router();

// Helper function to render EJS templates
async function renderTemplate(
  templateName: string,
  data: Record<string, any>
): Promise<string> {
  const viewsDir = path.join(__dirname, '../../views');
  const templatePath = path.join(viewsDir, `${templateName}.ejs`);
  
  // Read CSS file if exists
  let styles = '';
  try {
    const cssPath = path.join(viewsDir, `${templateName}.css`);
    styles = await fs.readFile(cssPath, 'utf-8');
  } catch (error) {
    // CSS file is optional
  }
  
  // Render the template body
  const bodyHtml = await ejs.renderFile(templatePath, { ...data, path, process });
  
  // Render with layout
  const layoutPath = path.join(viewsDir, 'layout.ejs');
  return ejs.renderFile(layoutPath, {
    title: data.title || 'Admin',
    body: bodyHtml,
    extraStyles: styles,
  });
}

router.get('/breaker', async (req: Request, res: Response) => {
  try {
    const breaker = getBreakerService();
    const stats = await breaker.getAllStats();

    const breakerData = stats.map((s) => ({
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
    }));

    // Check if client wants HTML
    const acceptsHtml = req.accepts('html');
    
    if (acceptsHtml) {
      // Render HTML view using EJS template
      const html = await renderTemplate('breaker', {
        title: 'Circuit Breaker Status',
        breakerData,
      });
      
      return res.type('html').send(html);
    }

    // Return JSON if not HTML
    return res.json({
      timestamp: new Date().toISOString(),
      breakerCount: stats.length,
      breakers: breakerData,
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
 * GET /admin/runs/:id - Get detailed run information including findings and artifacts
 * Returns HTML view if Accept: text/html, otherwise JSON
 */
router.get('/runs/:id', async (req: Request, res: Response) => {
  try {
    const runId = req.params.id;
    const { eq } = await import('drizzle-orm');
    
    // Get the run
    const runResult = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);

    if (!runResult || runResult.length === 0) {
      return res.status(404).json({
        error: 'Run not found',
        id: runId,
      });
    }

    const run = runResult[0];

    // Get all findings for this run with their artifacts
    const findingsResult = await db
      .select({
        finding: findings,
        artifact: artifacts,
      })
      .from(findings)
      .leftJoin(artifacts, eq(artifacts.findingId, findings.id))
      .where(eq(findings.runId, runId));

    // Group artifacts by finding
    const findingsMap = new Map<string, {
      finding: typeof findings.$inferSelect;
      artifacts: typeof artifacts.$inferSelect[];
    }>();

    findingsResult.forEach((row) => {
      if (!findingsMap.has(row.finding.id)) {
        findingsMap.set(row.finding.id, {
          finding: row.finding,
          artifacts: [],
        });
      }
      if (row.artifact) {
        findingsMap.get(row.finding.id)!.artifacts.push(row.artifact);
      }
    });

    const findingsWithArtifacts = Array.from(findingsMap.values());

    // Check if client wants HTML
    const acceptsHtml = req.accepts('html');
    
    if (acceptsHtml) {
      // Status colors for rendering
      const statusColors: Record<string, string> = {
        queued: '#6c757d',
        in_progress: '#0066cc',
        completed: '#28a745',
        failed: '#dc3545',
        pending: '#6c757d',
        scanning: '#0066cc',
        processing: '#0066cc',
        evidence_captured: '#28a745',
        suppressed: '#ffc107',
      };

      // Render HTML view using EJS template
      const html = await renderTemplate('run-detail', {
        title: `Run ${runId.slice(0, 8)}`,
        run,
        findingsWithArtifacts,
        statusColors,
      });
      
      return res.type('html').send(html);
    }

    // Return JSON if not HTML
    // Include full artifact file paths for Day-6 requirements
    return res.json({
      run,
      findings: findingsWithArtifacts.map(({ finding, artifacts: findingArtifacts }) => ({
        ...finding,
        artifacts: findingArtifacts.map(artifact => ({
          ...artifact,
          fullPath: `artifacts/${artifact.storageUrl}`,
          absolutePath: `${process.cwd()}/artifacts/${artifact.storageUrl}`,
        })),
      })),
    });
  } catch (error) {
    logger.error('[Admin] Error fetching run details', {
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to fetch run details',
      message: error instanceof Error ? error.message : String(error),
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
