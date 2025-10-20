import { IFetcher, FetchOptions, FetchResult, FetcherAdapterOptions } from '../types';
import { retryWithBackoff, DEFAULT_RETRY_CONFIG, isRetryableError } from '../retry';
import { logger } from '../../../utils/logger';

export class DirectFetcher implements IFetcher {
  private defaultTimeoutMs: number;
  private defaultRetries: number;
  private debug: boolean;

  constructor(options: FetcherAdapterOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs || 30000; // 30 seconds
    this.defaultRetries = options.defaultRetries || 3;
    this.debug = options.debug || false;
  }

  async fetch(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;
    const retries = options.retries !== undefined ? options.retries : this.defaultRetries;

    if (this.debug) {
      logger.debug(`[DirectFetcher] Fetching ${url}`, { timeoutMs, retries });
    }

    try {
      // Use retry with backoff
      const result = await retryWithBackoff(
        async () => this._fetchOnce(url, options, timeoutMs),
        {
          ...DEFAULT_RETRY_CONFIG,
          maxRetries: retries,
        },
        (error) => isRetryableError(error)
      );

      const latencyMs = Date.now() - startTime;
      return {
        ...result,
        latencyMs,
        success: result.status !== null && result.status >= 200 && result.status < 300,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(`[DirectFetcher] Failed to fetch ${url}`, { error: errorMessage });

      return {
        status: null,
        error: errorMessage,
        latencyMs,
        success: false,
        attempts: retries + 1,
      };
    }
  }

  private async _fetchOnce(
    url: string,
    options: FetchOptions,
    timeoutMs: number
  ): Promise<Omit<FetchResult, 'latencyMs' | 'success' | 'skipped' | 'reason'>> {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Prepare fetch options
      const fetchOptions: RequestInit = {
        method: options.method || 'GET',
        headers: options.headers || {},
        signal: controller.signal,
        redirect: options.followRedirects === false ? 'manual' : 'follow',
        ...options.fetchOptions,
      };

      // Add body for POST/PUT/PATCH
      if (options.body && ['POST', 'PUT', 'PATCH'].includes(fetchOptions.method || 'GET')) {
        fetchOptions.body = options.body;
      }

      // Perform the fetch
      const response = await fetch(url, fetchOptions);

      // Extract response body
      let body: string | undefined;
      try {
        body = await response.text();
      } catch (error) {
        logger.warn('[DirectFetcher] Failed to read response body', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Extract response headers
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: response.status,
        body,
        headers,
      };
    } catch (error) {
      // Handle timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }

      // Re-throw other errors
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  getAdapterName(): string {
    return 'direct';
  }
}

export function createDirectFetcher(options?: FetcherAdapterOptions): IFetcher {
  return new DirectFetcher(options);
}
