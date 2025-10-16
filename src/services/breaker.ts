import Redis from 'ioredis';
import { logger } from '../utils/logger';

export interface BreakerConfig {
  /** Number of consecutive failures before opening the circuit */
  failThreshold: number;
  /** Duration in milliseconds to keep circuit open before transitioning to half-open */
  openDurationMs: number;
  /** Duration in milliseconds to wait before next probe if half-open probe fails */
  halfOpenProbeDelayMs: number;
  /** Window size for tracking failure rate (default: 10) */
  failureWindowSize?: number;
  /** Failure rate threshold (0-1, default: 0.5 = 50%) */
  failureRateThreshold?: number;
}

export type BreakerState = 'open' | 'half_open' | 'closed';

const DEFAULT_CONFIG: BreakerConfig = {
  failThreshold: 3,
  openDurationMs: 30 * 60 * 1000, // 30 minutes
  halfOpenProbeDelayMs: 60 * 60 * 1000, // 60 minutes
  failureWindowSize: 10,
  failureRateThreshold: 0.5, // 50%
};

export class BreakerService {
  private redis: Redis;
  private config: Required<BreakerConfig>;

  constructor(redis: Redis, config: Partial<BreakerConfig> = {}) {
    this.redis = redis;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      failureWindowSize: config.failureWindowSize ?? DEFAULT_CONFIG.failureWindowSize!,
      failureRateThreshold: config.failureRateThreshold ?? DEFAULT_CONFIG.failureRateThreshold!,
    };
  }

  private getKeys(targetId: string) {
    return {
      state: `cb:${targetId}:state`,
      failCount: `cb:${targetId}:fail_count`,
      nextProbe: `cb:${targetId}:next_probe`,
      openedAt: `cb:${targetId}:opened_at`,
      failureWindow: `cb:${targetId}:failure_window`,
    };
  }

  async getState(targetId: string): Promise<BreakerState> {
    try {
      const keys = this.getKeys(targetId);
      const state = await this.redis.get(keys.state);

      if (!state) {
        return 'closed';
      }

      // Check if we should transition from open to half-open
      if (state === 'open') {
        const nextProbeStr = await this.redis.get(keys.nextProbe);
        if (nextProbeStr) {
          const nextProbe = parseInt(nextProbeStr, 10);
          if (Date.now() >= nextProbe) {
            await this.transitionToHalfOpen(targetId);
            return 'half_open';
          }
        }
      }

      return state as BreakerState;
    } catch (error) {
      logger.error(`Failed to get breaker state for ${targetId}:`, error);
      // Default to closed on error to avoid blocking legitimate requests
      return 'closed';
    }
  }

  private async transitionToHalfOpen(targetId: string): Promise<void> {
    try {
      const keys = this.getKeys(targetId);
      await this.redis.set(keys.state, 'half_open');
      logger.info(`Circuit breaker for ${targetId} transitioned to half-open`);
    } catch (error) {
      logger.error(`Failed to transition ${targetId} to half-open:`, error);
    }
  }

  async recordFailure(targetId: string, errorCode?: string): Promise<void> {
    try {
      const keys = this.getKeys(targetId);
      const currentState = await this.getState(targetId);

      // Track failure in sliding window
      await this.redis.lpush(keys.failureWindow, '0'); // 0 = failure
      await this.redis.ltrim(keys.failureWindow, 0, this.config.failureWindowSize - 1);

      // Increment failure counter
      const failCount = await this.redis.incr(keys.failCount);

      logger.warn(
        `Failure recorded for ${targetId} (count: ${failCount}, state: ${currentState})`,
        errorCode ? { errorCode } : {}
      );

      // Handle state-specific logic
      if (currentState === 'half_open') {
        // Failed probe → reopen circuit with extended cooldown
        await this.openCircuit(targetId, true);
        logger.warn(`Half-open probe failed for ${targetId}, reopening circuit`);
      } else if (currentState === 'closed') {
        // Check if we should open the circuit
        const shouldOpen = await this.shouldOpenCircuit(targetId, failCount);
        if (shouldOpen) {
          await this.openCircuit(targetId, false);
          logger.warn(`Circuit opened for ${targetId} after ${failCount} failures`);
        }
      }
    } catch (error) {
      logger.error(`Failed to record failure for ${targetId}:`, error);
    }
  }

  async recordSuccess(targetId: string): Promise<void> {
    try {
      const keys = this.getKeys(targetId);
      const currentState = await this.getState(targetId);

      // Track success in sliding window
      await this.redis.lpush(keys.failureWindow, '1'); // 1 = success
      await this.redis.ltrim(keys.failureWindow, 0, this.config.failureWindowSize - 1);

      logger.debug(`Success recorded for ${targetId} (state: ${currentState})`);

      // If half-open and probe succeeded, reset to closed
      if (currentState === 'half_open') {
        await this.resetCircuit(targetId);
        logger.info(`Circuit breaker for ${targetId} reset to closed after successful probe`);
      }
    } catch (error) {
      logger.error(`Failed to record success for ${targetId}:`, error);
    }
  }

  private async shouldOpenCircuit(targetId: string, failCount: number): Promise<boolean> {
    try {
      // Check consecutive failure threshold
      if (failCount >= this.config.failThreshold) {
        return true;
      }

      // Check failure rate in sliding window
      const keys = this.getKeys(targetId);
      const window = await this.redis.lrange(
        keys.failureWindow,
        0,
        this.config.failureWindowSize - 1
      );

      if (window.length >= this.config.failureWindowSize) {
        const failures = window.filter((v) => v === '0').length;
        const failureRate = failures / window.length;

        if (failureRate >= this.config.failureRateThreshold) {
          logger.warn(
            `Failure rate threshold exceeded for ${targetId}: ${(failureRate * 100).toFixed(1)}%`
          );
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error(`Failed to check if circuit should open for ${targetId}:`, error);
      return false;
    }
  }

  private async openCircuit(targetId: string, isProbeFailure: boolean): Promise<void> {
    try {
      const keys = this.getKeys(targetId);
      const now = Date.now();

      // Use extended delay for failed probes
      const delayMs = isProbeFailure
        ? this.config.halfOpenProbeDelayMs
        : this.config.openDurationMs;

      const nextProbe = now + delayMs;

      await this.redis
        .multi()
        .set(keys.state, 'open')
        .set(keys.openedAt, now.toString())
        .set(keys.nextProbe, nextProbe.toString())
        .exec();

      logger.info(
        `Circuit breaker opened for ${targetId}, next probe at ${new Date(nextProbe).toISOString()}`
      );
    } catch (error) {
      logger.error(`Failed to open circuit for ${targetId}:`, error);
    }
  }

  private async resetCircuit(targetId: string): Promise<void> {
    try {
      const keys = this.getKeys(targetId);

      await this.redis
        .multi()
        .set(keys.state, 'closed')
        .set(keys.failCount, '0')
        .del(keys.openedAt)
        .del(keys.nextProbe)
        .del(keys.failureWindow)
        .exec();

      logger.info(`Circuit breaker reset to closed for ${targetId}`);
    } catch (error) {
      logger.error(`Failed to reset circuit for ${targetId}:`, error);
    }
  }

  async shouldSkip(targetId: string): Promise<boolean> {
    try {
      const state = await this.getState(targetId);
      return state === 'open';
    } catch (error) {
      logger.error(`Failed to check if should skip ${targetId}:`, error);
      // Default to allowing requests on error
      return false;
    }
  }

  async getNextProbeETA(targetId: string): Promise<number> {
    try {
      const state = await this.getState(targetId);

      if (state !== 'open') {
        return 0;
      }

      const keys = this.getKeys(targetId);
      const nextProbeStr = await this.redis.get(keys.nextProbe);

      if (!nextProbeStr) {
        return 0;
      }

      const nextProbe = parseInt(nextProbeStr, 10);
      const eta = Math.max(0, nextProbe - Date.now());

      return eta;
    } catch (error) {
      logger.error(`Failed to get next probe ETA for ${targetId}:`, error);
      return 0;
    }
  }

  async getStats(targetId: string): Promise<{
    state: BreakerState;
    failCount: number;
    nextProbeETA: number;
    openedAt: number | null;
    failureRate: number | null;
  }> {
    try {
      const keys = this.getKeys(targetId);
      const [state, failCountStr, openedAtStr, window] = await Promise.all([
        this.getState(targetId),
        this.redis.get(keys.failCount),
        this.redis.get(keys.openedAt),
        this.redis.lrange(keys.failureWindow, 0, this.config.failureWindowSize - 1),
      ]);

      const failCount = parseInt(failCountStr || '0', 10);
      const openedAt = openedAtStr ? parseInt(openedAtStr, 10) : null;
      const nextProbeETA = await this.getNextProbeETA(targetId);

      let failureRate: number | null = null;
      if (window.length > 0) {
        const failures = window.filter((v) => v === '0').length;
        failureRate = failures / window.length;
      }

      return {
        state,
        failCount,
        nextProbeETA,
        openedAt,
        failureRate,
      };
    } catch (error) {
      logger.error(`Failed to get stats for ${targetId}:`, error);
      return {
        state: 'closed',
        failCount: 0,
        nextProbeETA: 0,
        openedAt: null,
        failureRate: null,
      };
    }
  }
}

let breakerInstance: BreakerService | null = null;

export function initializeBreakerService(
  redis: Redis,
  config?: Partial<BreakerConfig>
): BreakerService {
  breakerInstance = new BreakerService(redis, config);
  logger.info('Circuit Breaker service initialized');
  return breakerInstance;
}

export function getBreakerService(): BreakerService {
  if (!breakerInstance) {
    throw new Error('Breaker service not initialized. Call initializeBreakerService() first.');
  }
  return breakerInstance;
}

export async function isBreakerOpen(targetId: string): Promise<boolean> {
  try {
    const breaker = getBreakerService();
    return await breaker.shouldSkip(targetId);
  } catch (error) {
    logger.error(`Failed to check if breaker is open for ${targetId}:`, error);
    // Default to allowing requests on error
    return false;
  }
}
