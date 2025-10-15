import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../config/redis';
import { config } from '../config';
import { ScanJobData } from '../workers/scanWorker';

let scanQueue: Queue<ScanJobData> | null = null;

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

export async function addScanJob(data: ScanJobData) {
  const queue = getScanQueue();
  
  const job = await queue.add('scan', data, {
    jobId: `scan-${data.findingId}-${Date.now()}`,
  });

  return job;
}

export async function closeScanQueue() {
  if (scanQueue) {
    await scanQueue.close();
    scanQueue = null;
  }
}
