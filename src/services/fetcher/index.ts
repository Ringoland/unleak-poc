export * from './types';
export * from './retry';

// Adapters
export { DirectFetcher, createDirectFetcher } from './adapters/direct';
export { ZenRowsFetcher, createZenRowsFetcher } from './adapters/zenrows';

import { IFetcher, FetcherAdapterOptions, FetchOptions, FetchResult } from './types';
import { createDirectFetcher } from './adapters/direct';
import { createZenRowsFetcher } from './adapters/zenrows';
import { logger } from '../../utils/logger';
import { BreakerService } from '../breaker';
import { config } from '../../config';

export type FetcherAdapter = 'direct' | 'zenrows';

export interface FetcherFactoryOptions extends FetcherAdapterOptions {
  /** Which adapter to use */
  adapter?: FetcherAdapter;
}

/**
 * Breaker-aware fetcher wrapper that integrates circuit breaker logic
 */
export class BreakerAwareFetcher implements IFetcher {
  private adapter: IFetcher;
  private breaker: BreakerService;

  constructor(adapter: IFetcher, breaker: BreakerService) {
    this.adapter = adapter;
    this.breaker = breaker;
  }

  async fetch(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const { targetId } = options;

    // If breaker is disabled, skip all breaker logic
    if (!config.circuitBreaker.enabled) {
      return this.adapter.fetch(url, options);
    }

    // If no targetId provided, skip breaker logic and use adapter directly
    if (!targetId) {
      logger.debug('[BreakerAwareFetcher] No targetId provided, skipping breaker logic');
      return this.adapter.fetch(url, options);
    }

    // Check if breaker is open for this target
    const shouldSkip = await this.breaker.shouldSkip(targetId);
    if (shouldSkip) {
      logger.warn(`[breaker] Target ${targetId} skipped (open)`);
      return {
        success: false,
        skipped: true,
        reason: 'breaker_open',
        status: null,
        latencyMs: 0,
      };
    }

    // Wrap the fetch with breaker logic
    return this.wrapWithBreaker(targetId, async () => {
      return this.adapter.fetch(url, options);
    });
  }

  /**
   * Helper that wraps a fetch callback with breaker state management
   */
  private async wrapWithBreaker(
    targetId: string,
    fetchFn: () => Promise<FetchResult>
  ): Promise<FetchResult> {
    const startTime = performance.now();

    try {
      const result = await fetchFn();
      const latencyMs = performance.now() - startTime;

      // Update result with measured latency
      result.latencyMs = latencyMs;

      // Record success or failure based on status code
      if (result.success && result.status && result.status >= 200 && result.status < 300) {
        await this.breaker.recordSuccess(targetId);
        logger.debug(`[breaker] Success recorded for target ${targetId}`);
      } else if (result.status && result.status >= 500) {
        // 5xx errors are server failures
        await this.breaker.recordFailure(targetId, `HTTP_${result.status}`);
        logger.warn(`[breaker] Failure recorded for target ${targetId} (HTTP ${result.status})`);
      } else if (!result.success && result.error) {
        // Network errors, timeouts, etc.
        await this.breaker.recordFailure(targetId, result.error);
        logger.warn(`[breaker] Failure recorded for target ${targetId} (${result.error})`);
      }

      return result;
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Record failure for any exception
      await this.breaker.recordFailure(targetId, errorMessage);
      logger.error(
        `[breaker] Failure recorded for target ${targetId} (exception: ${errorMessage})`
      );

      return {
        success: false,
        status: null,
        error: errorMessage,
        latencyMs,
      };
    }
  }

  getAdapterName(): string {
    return `breaker-aware-${this.adapter.getAdapterName()}`;
  }
}

export function createFetcher(options: FetcherFactoryOptions = {}): IFetcher {
  const adapter = options.adapter || 'direct';

  logger.info(`[Fetcher] Creating ${adapter} adapter`);

  switch (adapter) {
    case 'direct':
      return createDirectFetcher(options);

    case 'zenrows':
      return createZenRowsFetcher(options);

    default:
      logger.warn(`[Fetcher] Unknown adapter: ${adapter}, falling back to direct`);
      return createDirectFetcher(options);
  }
}

let defaultFetcherInstance: IFetcher | null = null;

/**
 * Create a breaker-aware fetcher with the specified adapter and breaker service
 */
export function createBreakerAwareFetcher(
  breaker: BreakerService,
  options: FetcherFactoryOptions = {}
): IFetcher {
  const adapter = createFetcher(options);
  return new BreakerAwareFetcher(adapter, breaker);
}

export function getDefaultFetcher(): IFetcher {
  if (!defaultFetcherInstance) {
    defaultFetcherInstance = createDirectFetcher({
      defaultTimeoutMs: 30000,
      defaultRetries: 3,
      debug: process.env.NODE_ENV !== 'production',
    });
  }
  return defaultFetcherInstance;
}

export async function quickFetch(url: string, options?: Parameters<IFetcher['fetch']>[1]) {
  const fetcher = getDefaultFetcher();
  return fetcher.fetch(url, options);
}
