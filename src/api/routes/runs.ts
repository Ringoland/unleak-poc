import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { runService } from '../../services/runService';
import { loadAllowList } from '../../utils/allow-list';

const router: Router = Router();

// POST /api/runs
router.post('/', async (req: Request, res: Response) => {
  try {
    const { payload } = req.body;
    const urls = loadAllowList();

    // Validate URLs array
    const urlList = Array.isArray(urls) ? urls : [];

    if (urlList.length === 0) {
      return res.status(400).json({
        error: 'No URLs provided',
        message: 'At least one URL is required to create a run',
      });
    }

    // Create run and enqueue jobs using RunService
    const result = await runService.createRun({
      urls: urlList,
      payload,
      runType: 'manual',
    });

    logger.info(
      `Created run ${result.run.id}: ${result.findings.length} findings, ${result.jobIds.length} jobs enqueued`
    );

    // Return response matching client format
    return res.status(201).json({
      id: result.run.id,
      submitted: result.run.submittedAt,
      count: result.run.urlCount,
      // Additional info for integration
      status: result.run.status,
      findings: result.findings.map((f) => f.id),
      jobsEnqueued: result.jobIds.length,
    });
  } catch (error) {
    logger.error('Failed to create run:', error);
    return res.status(500).json({
      error: 'Failed to create run',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET /api/runs/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get run with findings using RunService
    const run = await runService.getRun(id);

    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    // Get statistics
    const stats = await runService.getRunStats(id);

    // Return full run structure with findings
    return res.json({
      id: run.id,
      status: run.status,
      runType: run.runType,
      urlCount: run.urlCount,
      findingCount: run.findingCount,
      submittedAt: run.submittedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      payload: run.payload,
      error: run.error,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      // Additional info
      stats,
      findings: run.findings.map((f) => ({
        id: f.id,
        url: f.url,
        status: f.status,
        findingType: f.findingType,
        severity: f.severity,
        title: f.title,
        verified: f.verified,
        falsePositive: f.falsePositive,
        createdAt: f.createdAt,
      })),
    });
  } catch (error) {
    logger.error('Failed to fetch run:', error);
    return res.status(500).json({
      error: 'Failed to fetch run',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
