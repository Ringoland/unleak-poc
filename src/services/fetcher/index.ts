export * from './types';
export * from './retry';

// Adapters
export { DirectFetcher, createDirectFetcher } from './adapters/direct';

import { IFetcher, FetcherAdapterOptions } from './types';
import { createDirectFetcher } from './adapters/direct';
import { createZenRowsFetcher } from './adapters/zenrows';
import { logger } from '../../utils/logger';

export type FetcherAdapter = 'direct' | 'zenrows';

export interface FetcherFactoryOptions extends FetcherAdapterOptions {
  /** Which adapter to use */
  adapter?: FetcherAdapter;
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
