import 'dotenv/config';
import { createScanWorker } from '../workers/scanWorker';
import { initializeRedis } from '../config/redis';
import { logger } from '../utils/logger';

async function main() {
  try {
    logger.info('=== Starting Scan Worker ===');

    // Initialize Redis
    await initializeRedis();
    logger.info('Redis connected');

    // Create and start the scan worker
    const worker = createScanWorker();
    logger.info('Scan worker started and waiting for jobs...');
    logger.info('Press Ctrl+C to stop the worker');

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down scan worker...');
      await worker.close();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error('Failed to start scan worker:', error);
    process.exit(1);
  }
}

main();
