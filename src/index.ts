import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import { config } from './config';
import { initializeRedis, getRedisClient } from './config/redis';
import { initializeBullBoard, getBullBoardAdapter } from './config/bullBoard';
import apiRoutes from './api/index';
import { errorHandler } from './api/middleware/errorHandler';
import { bullBoardAuth } from './api/middleware/bullBoardAuth';
import { logger } from './utils/logger';
import { getMetrics } from './utils/metrics';
import { initializeBreakerService } from './services/breaker';
import { initializeFetcher } from './services/fetcher';

const app = express();
const port = config.port;

// Middleware
app.use(express.json());
app.use(morgan('combined'));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Prometheus metrics endpoint
app.get('/metrics', async (_req, res) => {
  try {
    res.set('Content-Type', 'text/plain; version=0.0.4');
    const metrics = await getMetrics();
    res.send(metrics);
  } catch (error) {
    logger.error('Error generating metrics:', error);
    res.status(500).send('Error generating metrics');
  }
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

    // Initialize Circuit Breaker service (if enabled)
    if (config.circuitBreaker.enabled) {
      const redis = getRedisClient();
      initializeBreakerService(redis, {
        failThreshold: 3,
        openDurationMs: 20 * 60 * 1000, // 20 minutes
        halfOpenProbeDelayMs: 40 * 60 * 1000, // 40 minutes (exponential backoff)
        failureWindowSize: config.circuitBreaker.errorRateWindow,
        failureRateThreshold: config.circuitBreaker.errorRateThresholdPct / 100,
      });
      logger.info('Circuit Breaker service initialized');
    }

    // Initialize Fetcher service
    initializeFetcher({
      adapter: (process.env.FETCHER_ADAPTER as 'direct' | 'zenrows') || 'direct',
      defaultTimeoutMs: parseInt(process.env.FETCHER_TIMEOUT_MS || '30000'),
      defaultRetries: parseInt(process.env.FETCHER_RETRIES || '3'),
    });
    logger.info('Fetcher service initialized');
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
