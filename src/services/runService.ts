import { db } from '../db';
import { runs, findings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { addScanJob } from './queueService';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';
import {
  recordRunCreated,
  recordRunStatus,
  recordFindingCreated,
  recordRunDuration,
  updateActiveRuns,
} from '../utils/metrics';

export interface CreateRunInput {
  urls: string[];
  payload?: any;
  runType?: 'manual' | 'scheduled' | 'webhook';
}

export interface CreateRunResult {
  run: any;
  findings: any[];
  jobIds: string[];
}

export class RunService {
  /**
   * Create a new run and enqueue jobs for all URLs
   */
  async createRun(input: CreateRunInput): Promise<CreateRunResult> {
    const { urls, payload, runType = 'manual' } = input;

    if (!urls || urls.length === 0) {
      throw new Error('At least one URL is required');
    }

    // Validate URLs
    const validUrls = urls.filter((url) => {
      try {
        new URL(url);
        return true;
      } catch {
        logger.warn(`Invalid URL skipped: ${url}`);
        return false;
      }
    });

    if (validUrls.length === 0) {
      throw new Error('No valid URLs provided');
    }

    // Create run
    const [run] = await db
      .insert(runs)
      .values({
        status: 'queued',
        urlCount: validUrls.length,
        runType,
        payload: payload || { urls: validUrls },
      })
      .returning();

    logger.info(`Created run ${run.id} with ${validUrls.length} URLs`);

    // Record metrics
    recordRunCreated(runType);
    recordRunStatus('queued');
    updateActiveRuns(1); // Increment active runs

    // Create findings and enqueue jobs
    const createdFindings = [];
    const jobIds = [];

    for (const url of validUrls) {
      try {
        const [finding] = await db
          .insert(findings)
          .values({
            runId: run.id,
            url,
            status: 'pending',
            findingType: 'scan',
            severity: 'low',
            title: `Scan for ${url}`,
            description: `Automated scan initiated by run ${run.id}`,
            fingerprint: nanoid(),
          })
          .returning();

        createdFindings.push(finding);
        logger.info(`Created finding ${finding.id} for URL: ${url}`);

        // Record metrics
        recordFindingCreated('scan', 'low');

        // Enqueue scan job (scan worker will then queue render job)
        const job = await addScanJob({
          findingId: finding.id,
          url,
        });

        jobIds.push(job.id!);
        logger.info(`Enqueued scan job ${job.id} for finding ${finding.id}`);
      } catch (error) {
        logger.error(`Failed to create finding for URL ${url}:`, error);
        // Continue with other URLs
      }
    }

    // Update run status to in_progress if jobs were enqueued
    if (jobIds.length > 0) {
      await db
        .update(runs)
        .set({
          status: 'in_progress',
          startedAt: new Date(),
        })
        .where(eq(runs.id, run.id));
      
      // Record status change
      recordRunStatus('in_progress');
    }

    logger.info(
      `Run ${run.id} initialized: ${createdFindings.length} findings, ${jobIds.length} jobs enqueued`
    );

    return {
      run: { ...run, status: jobIds.length > 0 ? 'in_progress' : 'queued' },
      findings: createdFindings,
      jobIds,
    };
  }

  /**
   * Get run with findings
   */
  async getRun(runId: string) {
    const [run] = await db.select().from(runs).where(eq(runs.id, runId));

    if (!run) {
      return null;
    }

    const runFindings = await db.select().from(findings).where(eq(findings.runId, runId));

    return {
      ...run,
      findings: runFindings,
    };
  }

  /**
   * Update run status based on findings completion
   */
  async checkAndUpdateRunStatus(runId: string): Promise<boolean> {
    const runFindings = await db.select().from(findings).where(eq(findings.runId, runId));

    if (runFindings.length === 0) {
      return false;
    }

    // Check if all findings are in a terminal state
    const allComplete = runFindings.every(
      (f) =>
        f.status === 'evidence_captured' ||
        f.status === 'completed' ||
        f.status === 'failed' ||
        f.status === 'resolved'
    );

    if (allComplete) {
      const [updatedRun] = await db
        .update(runs)
        .set({
          status: 'completed',
          completedAt: new Date(),
          findingCount: runFindings.length,
        })
        .where(eq(runs.id, runId))
        .returning();

      // Record metrics
      recordRunStatus('completed');
      updateActiveRuns(-1); // Decrement active runs
      
      // Record run duration if we have startedAt
      if (updatedRun.startedAt && updatedRun.completedAt) {
        const durationSeconds = (updatedRun.completedAt.getTime() - updatedRun.startedAt.getTime()) / 1000;
        recordRunDuration(durationSeconds);
      }

      logger.info(`Run ${runId} marked as completed`);
      return true;
    }

    return false;
  }

  /**
   * Get statistics for a run
   */
  async getRunStats(runId: string) {
    const runFindings = await db.select().from(findings).where(eq(findings.runId, runId));

    const stats = {
      total: runFindings.length,
      pending: 0,
      processing: 0,
      evidenceCaptured: 0,
      completed: 0,
      failed: 0,
    };

    for (const finding of runFindings) {
      switch (finding.status) {
        case 'pending':
          stats.pending++;
          break;
        case 'processing':
          stats.processing++;
          break;
        case 'evidence_captured':
          stats.evidenceCaptured++;
          break;
        case 'completed':
          stats.completed++;
          break;
        case 'failed':
          stats.failed++;
          break;
      }
    }

    return stats;
  }
}

export const runService = new RunService();
