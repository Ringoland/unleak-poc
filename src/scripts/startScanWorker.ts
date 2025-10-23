import 'dotenv/config';
import { createScanWorker } from '../workers/scanWorker';
import { initializeRedis } from '../config/redis';
import { loadRulesConfig } from '../services/rulesService';
import { loadAllowList } from '../services/allowListService';
import { logger } from '../utils/logger';

async function main() {
  try {
    logger.info('=== Starting Scan Worker ===');

    // Initialize Redis
    await initializeRedis();
    logger.info('Redis connected');

    // Load rules configuration
    try {
      loadRulesConfig();
      logger.info('Rules engine configuration loaded successfully');
    } catch (error) {
      logger.error('Failed to load rules configuration:', error);
      logger.warn('Scan worker will continue without rules engine');
    }

    // Load allow-list
    try {
      loadAllowList();
      logger.info('Allow-list loaded successfully');
    } catch (error) {
      logger.error('Failed to load allow-list:', error);
      logger.warn('Scan worker will continue without allow-list');
    }

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
