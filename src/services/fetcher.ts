import { IFetcher } from './fetcher/types';
import { createFetcher, FetcherFactoryOptions } from './fetcher/index';
import { logger } from '../utils/logger';

let fetcherInstance: IFetcher | null = null;

export function initializeFetcher(options: FetcherFactoryOptions = {}): IFetcher {
  try {
    fetcherInstance = createFetcher({
      adapter: options.adapter || 'direct',
      defaultTimeoutMs: options.defaultTimeoutMs || 30000,
      defaultRetries: options.defaultRetries || 3,
      debug: options.debug ?? process.env.NODE_ENV !== 'production',
      ...options,
    });

    logger.info('[Fetcher] Initialized', {
      adapter: options.adapter || 'direct',
      timeout: options.defaultTimeoutMs || 30000,
    });

    return fetcherInstance;
  } catch (error) {
    logger.error('[Fetcher] Failed to initialize', error);
    throw error;
  }
}

export function getFetcher(): IFetcher {
  if (!fetcherInstance) {
    throw new Error('Fetcher not initialized. Call initializeFetcher() first.');
  }
  return fetcherInstance;
}

export async function fetch(
  url: string,
  options?: Parameters<IFetcher['fetch']>[1]
): Promise<ReturnType<IFetcher['fetch']>> {
  const fetcher = getFetcher();
  return fetcher.fetch(url, options);
}

export const fetcher = {
  get instance(): IFetcher {
    return getFetcher();
  },

  fetch: fetch,
};
