export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '8000', 10),

  // Database configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'unleak_poc',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || undefined,
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10),
  },

  // Redis configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },

  // BullMQ configuration
  bullmq: {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential' as const,
        delay: 1000,
      },
    },
  },

  // Application-specific config
  reverifyTtlSeconds: parseInt(process.env.REVERIFY_TTL_SECONDS || '120', 10),
  reverifyRatePerFindingPerHour: parseInt(
    process.env.REVERIFY_RATE_PER_FINDING_PER_HOUR || '5',
    10
  ),

  // Circuit breaker config
  circuitBreaker: {
    enabled: process.env.BREAKER_ENABLED === 'true',
    openMinutes: parseInt(process.env.BREAKER_OPEN_MINUTES || '20', 10),
    errorRateThresholdPct: parseInt(process.env.BREAKER_ERROR_RATE_THRESHOLD_PCT || '50', 10),
    errorRateWindow: parseInt(process.env.BREAKER_ERROR_RATE_WINDOW || '10', 10),
  },

  // Admin routes
  admin: {
    enabled: process.env.ADMIN_ENABLED === 'true',
    username: process.env.BULL_BOARD_USERNAME || 'admin',
    password: process.env.BULL_BOARD_PASSWORD || 'admin',
  },

  // External services
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || '',
  stripeApiKey: process.env.STRIPE_API_KEY || '',
};
