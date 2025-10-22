import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../config/redis';
import { browserService, type EvidenceCapture } from '../services/browserService';
import { artifactService } from '../services/artifactService';
import { storageService } from '../services/storageService';
import { runService } from '../services/runService';
import { db } from '../db';
import { findings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';

export interface RenderJobData {
  findingId: string;
  url: string;
  targetId?: string;
  options?: {
    timeout?: number;
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
    captureHAR?: boolean;
  };
}

export interface RenderJobResult {
  findingId: string;
  artifactIds: string[];
  evidenceMetadata: {
    url: string;
    title: string;
    loadTime: number;
    consoleLogCount: number;
    screenshotSize: number;
    htmlSize: number;
  };
}

export function createRenderWorker() {
  const connection = getRedisClient();

  const worker = new Worker<RenderJobData, RenderJobResult>(
    'render-queue',
    async (job: Job<RenderJobData>) => {
      logger.info(`Processing render job ${job.id} for URL: ${job.data.url}`);

      try {
        // Update finding status to processing
        await db
          .update(findings)
          .set({
            status: 'processing',
            updatedAt: new Date(),
          })
          .where(eq(findings.id, job.data.findingId));

        logger.info(`Finding ${job.data.findingId} status updated to processing`);

        // Initialize storage if not already done
        await storageService.initialize();

        // Capture evidence using browser service
        let evidence: EvidenceCapture;
        try {
          evidence = await browserService.captureEvidence(job.data.url, {
            timeout: job.data.options?.timeout || 30000,
            waitUntil: job.data.options?.waitUntil || 'networkidle',
            captureHAR: job.data.options?.captureHAR !== false,
          });
        } catch (captureError) {
          // If evidence capture fails completely, create a minimal error artifact
          logger.error(`Failed to capture evidence for ${job.data.url}:`, captureError);
          
          // Save error information as console log artifact
          const errorArtifact = {
            findingId: job.data.findingId,
            type: 'console_logs' as const,
            data: [
              {
                timestamp: new Date().toISOString(),
                type: 'error',
                text: `Evidence capture failed: ${captureError instanceof Error ? captureError.message : String(captureError)}`,
              },
            ],
          };
          
          await artifactService.saveArtifacts([errorArtifact]);
          logger.warn(`Saved error artifact for failed evidence capture on ${job.data.url}`);
          
          // Re-throw to let BullMQ retry mechanism handle it
          throw new Error(
            `Evidence capture failed for ${job.data.url}: ${captureError instanceof Error ? captureError.message : String(captureError)}`
          );
        }

        logger.info(
          `Evidence captured for ${job.data.url}: ` +
            `${evidence.consoleLogs.length} logs, ` +
            `${evidence.screenshot.length} bytes screenshot, ` +
            `${evidence.html.length} bytes HTML`
        );

        // Save all artifacts
        const artifactInputs: Array<{
          findingId: string;
          type: 'screenshot' | 'html' | 'console_logs' | 'har';
          data: any;
        }> = [
          {
            findingId: job.data.findingId,
            type: 'screenshot',
            data: evidence.screenshot,
          },
          {
            findingId: job.data.findingId,
            type: 'html',
            data: evidence.html,
          },
          {
            findingId: job.data.findingId,
            type: 'console_logs',
            data: evidence.consoleLogs,
          },
        ];

        // Add HAR if available
        if (evidence.har) {
          artifactInputs.push({
            findingId: job.data.findingId,
            type: 'har' as const,
            data: evidence.har,
          });
        }

        const savedArtifacts = await artifactService.saveArtifacts(artifactInputs);

        logger.info(`Saved ${savedArtifacts.length} artifacts for finding ${job.data.findingId}`);

        // Update finding status to evidence_captured
        const [finding] = await db
          .update(findings)
          .set({
            status: 'evidence_captured',
            updatedAt: new Date(),
          })
          .where(eq(findings.id, job.data.findingId))
          .returning();

        if (finding) {
          logger.info(`Finding ${job.data.findingId} status updated to evidence_captured`);

          // Check if all findings in the run are complete and update run status
          if (finding.runId) {
            const runUpdated = await runService.checkAndUpdateRunStatus(finding.runId);
            if (runUpdated) {
              logger.info(`Run ${finding.runId} marked as completed`);
            }
          }
        }

        const result: RenderJobResult = {
          findingId: job.data.findingId,
          artifactIds: savedArtifacts.map((a) => a.id),
          evidenceMetadata: {
            url: evidence.url,
            title: evidence.title,
            loadTime: evidence.metadata.loadTime,
            consoleLogCount: evidence.consoleLogs.length,
            screenshotSize: evidence.screenshot.length,
            htmlSize: evidence.html.length,
          },
        };

        return result;
      } catch (error) {
        logger.error(`Render job ${job.id} failed:`, error);
        throw error;
      }
    },
    {
      connection,
      concurrency: 2, // Run 2 browsers in parallel
      limiter: {
        max: 10, // Max 10 jobs
        duration: 60000, // per minute
      },
      settings: {
        backoffStrategy: (attemptsMade: number) => {
          // Exponential backoff: 2s, 4s, 8s, etc.
          return Math.min(2000 * Math.pow(2, attemptsMade), 30000);
        },
      },
    }
  );

  worker.on('completed', (job, result) => {
    logger.info(
      `Render job ${job.id} completed: ` +
        `${result.artifactIds.length} artifacts saved for finding ${result.findingId}`
    );
  });

  worker.on('failed', async (job, err) => {
    const attemptsLeft = job ? (job.attemptsMade || 0) : 0;
    logger.error(`Render job ${job?.id} failed (attempt ${attemptsLeft}):`, err);

    // If this was the final attempt, mark finding as failed
    if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
      try {
        const [finding] = await db
          .update(findings)
          .set({
            status: 'failed',
            updatedAt: new Date(),
          })
          .where(eq(findings.id, job.data.findingId))
          .returning();

        if (finding) {
          logger.info(`Finding ${job.data.findingId} marked as failed after all retries exhausted`);

          // Check if all findings in the run are complete and update run status
          if (finding.runId) {
            await runService.checkAndUpdateRunStatus(finding.runId);
          }
        }
      } catch (error) {
        logger.error(`Failed to update finding status for ${job.data.findingId}:`, error);
      }
    }
  });

  worker.on('error', (err) => {
    logger.error('Render worker error:', err);
  });

  return worker;
}

// Graceful shutdown handler
export async function shutdownRenderWorker(worker: Worker) {
  logger.info('Shutting down render worker...');
  await worker.close();
  await browserService.close();
  logger.info('Render worker shut down');
}
