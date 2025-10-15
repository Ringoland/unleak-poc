import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import { config } from './config';
import { initializeRedis } from './config/redis';
import { initializeBullBoard, getBullBoardAdapter } from './config/bullBoard';
import apiRoutes from './api';
import { errorHandler } from './api/middleware/errorHandler';
import { bullBoardAuth } from './api/middleware/bullBoardAuth';
import { logger } from './utils/logger';

const app = express();
const port = config.port;

// Middleware
app.use(express.json());
app.use(morgan('combined'));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api', apiRoutes);

// Error handling middleware (must be last)
app.use(errorHandler);

// Initialize connections and start server
async function startServer() {
  try {
    // Initialize Redis connection
    await initializeRedis();
    logger.info('Redis connected successfully');

    // Initialize Bull Board after Redis is ready
    // Access at http://localhost:3000/admin/queues
    // Protected by basic authentication (set BULL_BOARD_USERNAME and BULL_BOARD_PASSWORD env vars)
    try {
      initializeBullBoard();
      app.use('/admin/queues', bullBoardAuth, getBullBoardAdapter().getRouter());
      logger.info('Bull Board dashboard available at /admin/queues');
    } catch (error) {
      logger.error('Failed to initialize Bull Board:', error);
    }

    // Start Express server
    app.listen(port, () => {
      logger.info(`Unleak PoC server listening on port ${port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT signal received: closing HTTP server');
  process.exit(0);
});

startServer();
