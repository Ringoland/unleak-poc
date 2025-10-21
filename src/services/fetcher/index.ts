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
import { sendSlackAlert } from '../slackService';
import { nanoid } from 'nanoid';
import { recordHttpRequest, recordBlockedRequest } from '../../utils/metrics';

export type FetcherAdapter = 'direct' | 'zenrows';

export interface FetcherFactoryOptions extends FetcherAdapterOptions {
  adapter?: FetcherAdapter;
}

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
      recordBlockedRequest(targetId); // Record metrics
      return {
        success: false,
        skipped: true,
        reason: 'breaker_open',
        status: null,
        latencyMs: 0,
      };
    }

    // Wrap the fetch with breaker logic
    return this.wrapWithBreaker(
      targetId,
      async () => {
        return this.adapter.fetch(url, options);
      },
      url
    );
  }

  private async wrapWithBreaker(
    targetId: string,
    fetchFn: () => Promise<FetchResult>,
    url?: string
  ): Promise<FetchResult> {
    const startTime = performance.now();
    const LATENCY_THRESHOLD_MS = 1500; // Alert if latency > 1500ms

    try {
      const result = await fetchFn();
      const latencyMs = performance.now() - startTime;

      // Update result with measured latency
      result.latencyMs = latencyMs;

      // Record HTTP metrics
      recordHttpRequest(targetId, result.status || null, latencyMs);

      // Record success or failure based on status code
      if (result.success && result.status && result.status >= 200 && result.status < 300) {
        await this.breaker.recordSuccess(targetId);
        logger.debug(`[breaker] Success recorded for target ${targetId}`);

        // Check for high latency even on success
        if (latencyMs > LATENCY_THRESHOLD_MS) {
          logger.warn(`[breaker] High latency detected for ${targetId}: ${latencyMs}ms`);
          
          // Send Slack alert for high latency (non-blocking)
          sendSlackAlert({
            findingId: nanoid(),
            url: url || targetId,
            errorType: 'latency',
            latencyMs,
            status: result.status,
            timestamp: new Date(),
          }).catch((err) => {
            logger.error('[breaker] Failed to send latency Slack alert', err);
          });
        }
      } else if (result.status && result.status >= 500) {
        // 5xx errors are server failures
        await this.breaker.recordFailure(targetId, `HTTP_${result.status}`);
        logger.warn(`[breaker] Failure recorded for target ${targetId} (HTTP ${result.status})`);

        // Send Slack alert for 5xx error (non-blocking)
        sendSlackAlert({
          findingId: nanoid(),
          url: url || targetId,
          errorType: '5xx',
          latencyMs,
          status: result.status,
          error: result.error,
          timestamp: new Date(),
        }).catch((err) => {
          logger.error('[breaker] Failed to send 5xx Slack alert', err);
        });
      } else if (!result.success && result.error) {
        // Network errors, timeouts, etc.
        await this.breaker.recordFailure(targetId, result.error);
        logger.warn(`[breaker] Failure recorded for target ${targetId} (${result.error})`);

        // Determine alert type based on error
        const isTimeout = result.error.toLowerCase().includes('timeout');
        const errorType = isTimeout ? 'timeout' : 'network';

        // Send Slack alert for network/timeout error (non-blocking)
        sendSlackAlert({
          findingId: nanoid(),
          url: url || targetId,
          errorType,
          latencyMs,
          error: result.error,
          timestamp: new Date(),
        }).catch((err) => {
          logger.error('[breaker] Failed to send network Slack alert', err);
        });
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

      // Send Slack alert for exception (non-blocking)
      sendSlackAlert({
        findingId: nanoid(),
        url: url || targetId,
        errorType: 'network',
        latencyMs,
        error: errorMessage,
        timestamp: new Date(),
      }).catch((err) => {
        logger.error('[breaker] Failed to send exception Slack alert', err);
      });

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
