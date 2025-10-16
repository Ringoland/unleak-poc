import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../config/redis';
import { browserService, type EvidenceCapture } from '../services/browserService';
import { artifactService } from '../services/artifactService';
import { storageService } from '../services/storageService';
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
        // Initialize storage if not already done
        await storageService.initialize();

        // Capture evidence using browser service
        const evidence: EvidenceCapture = await browserService.captureEvidence(job.data.url, {
          timeout: job.data.options?.timeout || 30000,
          waitUntil: job.data.options?.waitUntil || 'networkidle',
          captureHAR: job.data.options?.captureHAR !== false,
        });

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
    }
  );

  worker.on('completed', (job, result) => {
    logger.info(
      `Render job ${job.id} completed: ` +
        `${result.artifactIds.length} artifacts saved for finding ${result.findingId}`
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(`Render job ${job?.id} failed:`, err);
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
