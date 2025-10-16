import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../config/redis';
import { config } from '../config';
import { ScanJobData } from '../workers/scanWorker';
import { RenderJobData } from '../workers/renderWorker';

let scanQueue: Queue<ScanJobData> | null = null;
let renderQueue: Queue<RenderJobData> | null = null;

export function getScanQueue(): Queue<ScanJobData> {
  if (!scanQueue) {
    const connection = getRedisClient();

    const queueOptions: QueueOptions = {
      connection,
      defaultJobOptions: config.bullmq.defaultJobOptions,
    };

    scanQueue = new Queue<ScanJobData>('scan-queue', queueOptions);
  }

  return scanQueue;
}

export function getRenderQueue(): Queue<RenderJobData> {
  if (!renderQueue) {
    const connection = getRedisClient();

    const queueOptions: QueueOptions = {
      connection,
      defaultJobOptions: config.bullmq.defaultJobOptions,
    };

    renderQueue = new Queue<RenderJobData>('render-queue', queueOptions);
  }

  return renderQueue;
}

export async function addScanJob(data: ScanJobData) {
  const queue = getScanQueue();

  const job = await queue.add('scan', data, {
    jobId: `scan-${data.findingId}-${Date.now()}`,
  });

  return job;
}

export async function addRenderJob(data: RenderJobData) {
  const queue = getRenderQueue();

  const job = await queue.add('render', data, {
    jobId: `render-${data.findingId}-${Date.now()}`,
  });

  return job;
}

export async function closeScanQueue() {
  if (scanQueue) {
    await scanQueue.close();
    scanQueue = null;
  }
}

export async function closeRenderQueue() {
  if (renderQueue) {
    await renderQueue.close();
    renderQueue = null;
  }
}

export async function closeAllQueues() {
  await closeScanQueue();
  await closeRenderQueue();
}
