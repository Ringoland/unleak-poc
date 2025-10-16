import { RetryConfig } from './types';
import { logger } from '../../utils/logger';

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000, // Start at 1 second
  maxDelayMs: 20000, // Cap at 20 seconds
  useJitter: true,
};

export function calculateBackoff(attempt: number, config: RetryConfig): number {
  const { baseDelayMs, maxDelayMs, useJitter } = config;

  // Exponential backoff: 1s, 2s, 4s, 8s, 16s...
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);

  // Cap at maxDelayMs
  let delay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter (random ±25% variation)
  if (useJitter) {
    const jitter = delay * 0.25 * (Math.random() * 2 - 1); // Random between -25% and +25%
    delay = Math.max(0, delay + jitter);
  }

  return Math.floor(delay);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  shouldRetry?: (error: any, attempt: number) => boolean
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      // Try the operation
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= config.maxRetries) {
        logger.warn(`Retry limit reached (${config.maxRetries} attempts)`);
        break;
      }

      // Check custom retry condition
      if (shouldRetry && !shouldRetry(error, attempt)) {
        logger.warn(`Custom retry condition failed, not retrying`);
        break;
      }

      // Calculate backoff delay
      const delayMs = calculateBackoff(attempt, config);

      logger.info(`Retry attempt ${attempt + 1}/${config.maxRetries} after ${delayMs}ms`, {
        error: error instanceof Error ? error.message : String(error),
      });

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // All retries failed
  throw lastError;
}

export function isRetryableStatus(statusCode: number): boolean {
  const retryableCodes = [
    408, // Request Timeout
    429, // Too Many Requests
    500, // Internal Server Error
    502, // Bad Gateway
    503, // Service Unavailable
    504, // Gateway Timeout
  ];

  return retryableCodes.includes(statusCode);
}

export function isRetryableError(error: any): boolean {
  // Network errors
  if (error?.code === 'ECONNREFUSED') return true;
  if (error?.code === 'ENOTFOUND') return true;
  if (error?.code === 'ETIMEDOUT') return true;
  if (error?.code === 'ECONNRESET') return true;

  // Timeout errors
  if (error?.name === 'AbortError') return true;
  if (error?.name === 'TimeoutError') return true;

  // HTTP status codes
  if (error?.status && isRetryableStatus(error.status)) return true;
  if (error?.statusCode && isRetryableStatus(error.statusCode)) return true;

  return false;
}
