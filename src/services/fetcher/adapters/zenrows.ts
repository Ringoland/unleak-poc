import { IFetcher, FetchOptions, FetchResult, FetcherAdapterOptions } from '../types';
import { logger } from '../../../utils/logger';

export class ZenRowsFetcher implements IFetcher {
  private apiKey: string;
  // @ts-ignore - Used in future implementation
  private defaultTimeoutMs: number;
  private debug: boolean;

  constructor(options: FetcherAdapterOptions = {}) {
    // Get API key from environment or options
    this.apiKey = options.apiKey || process.env.ZENROWS_API_KEY || '';
    this.defaultTimeoutMs = options.defaultTimeoutMs || 30000;
    this.debug = options.debug || false;

    if (!this.apiKey && this.debug) {
      logger.warn(
        '[ZenRowsFetcher] No API key provided. Set ZENROWS_API_KEY environment variable.'
      );
    }
  }

  // @ts-ignore - options will be used in full implementation
  async fetch(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const startTime = Date.now();

    if (this.debug) {
      logger.debug(`[ZenRowsFetcher] Would fetch ${url} via ZenRows proxy`, {
        apiKey: this.apiKey ? '***' + this.apiKey.slice(-4) : 'NOT_SET',
      });
    }

    if (!this.apiKey) {
      const latencyMs = Date.now() - startTime;
      return {
        status: 0,
        error: 'ZenRows API key not configured. Set ZENROWS_API_KEY environment variable.',
        latencyMs,
        success: false,
      };
    }

    // Stub success response
    const latencyMs = Date.now() - startTime;
    logger.info('[ZenRowsFetcher] STUB: Would use ZenRows API', { url });

    return {
      status: 200,
      body: `<!-- ZenRows STUB Response for ${url} -->`,
      latencyMs,
      success: true,
      headers: {
        'x-zenrows-stub': 'true',
      },
    };
  }

  /**
   * Get adapter name
   */
  getAdapterName(): string {
    return 'zenrows';
  }

  /**
   * Check if ZenRows is properly configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  // @ts-ignore - Will be used in full implementation
  private _buildZenRowsUrl(targetUrl: string, options: ZenRowsOptions = {}): string {
    const baseUrl = 'https://api.zenrows.com/v1/';
    const params = new URLSearchParams({
      url: targetUrl,
      apikey: this.apiKey,
    });

    // Add optional parameters
    if (options.jsRender) params.append('js_render', 'true');
    if (options.premiumProxy) params.append('premium_proxy', 'true');
    if (options.waitFor) params.append('wait_for', options.waitFor.toString());

    return `${baseUrl}?${params.toString()}`;
  }
}

/**
 * ZenRows-specific options
 */
interface ZenRowsOptions {
  /** Enable JavaScript rendering */
  jsRender?: boolean;

  /** Use premium residential proxies */
  premiumProxy?: boolean;

  /** Wait time in milliseconds before returning */
  waitFor?: number;

  /** Enable CAPTCHA solving */
  autoparse?: boolean;
}

/**
 * Factory function to create a ZenRows fetcher instance
 */
export function createZenRowsFetcher(options?: FetcherAdapterOptions): IFetcher {
  return new ZenRowsFetcher(options);
}
