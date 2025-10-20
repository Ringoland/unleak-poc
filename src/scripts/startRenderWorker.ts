import 'dotenv/config';
import { createRenderWorker, shutdownRenderWorker } from '../workers/renderWorker';
import { initializeRedis } from '../config/redis';
import { storageService } from '../services/storageService';
import { logger } from '../utils/logger';

async function main() {
  try {
    logger.info('=== Starting Render Worker ===');

    // Initialize Redis
    await initializeRedis();
    logger.info('Redis connected');

    // Initialize storage
    await storageService.initialize();
    logger.info('Storage initialized');

    // Create and start the render worker
    const worker = createRenderWorker();
    logger.info('Render worker started and waiting for jobs...');
    logger.info('Press Ctrl+C to stop the worker');

    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down...');
      await shutdownRenderWorker(worker);
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down...');
      await shutdownRenderWorker(worker);
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start render worker:', error);
    process.exit(1);
  }
}

main();
