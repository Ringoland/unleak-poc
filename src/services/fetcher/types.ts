export interface FetchOptions {
  /** Request timeout in milliseconds */
  timeoutMs?: number;

  /** HTTP headers to include in the request */
  headers?: Record<string, string>;

  /** HTTP method (default: GET) */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

  /** Request body (for POST/PUT/PATCH) */
  body?: string | FormData | URLSearchParams;

  /** Number of retry attempts (default: 3) */
  retries?: number;

  /** Should follow redirects (default: true) */
  followRedirects?: boolean;

  /** Additional fetch options */
  fetchOptions?: RequestInit;

  /** Target ID for circuit breaker tracking */
  targetId?: string;
}

/**
 * Result from a fetch operation
 */
export interface FetchResult {
  /** HTTP status code (null if skipped by breaker) */
  status: number | null;

  /** Response body (if successful) */
  body?: string;

  /** Error message (if failed) */
  error?: string;

  /** Request latency in milliseconds */
  latencyMs: number;

  /** Was the request successful? */
  success: boolean;

  /** Number of retry attempts made */
  attempts?: number;

  /** Response headers */
  headers?: Record<string, string>;

  /** Was the request skipped by circuit breaker? */
  skipped?: boolean;

  /** Reason for skip (e.g., 'breaker_open') */
  reason?: string;
}

export interface IFetcher {
  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;
  getAdapterName(): string;
}

export interface FetcherAdapterOptions {
  /** Default timeout in milliseconds */
  defaultTimeoutMs?: number;

  /** Default number of retries */
  defaultRetries?: number;

  /** Enable debug logging */
  debug?: boolean;

  /** Additional adapter-specific options */
  [key: string]: any;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number;

  /** Base delay in milliseconds */
  baseDelayMs: number;

  /** Maximum delay in milliseconds */
  maxDelayMs: number;

  /** Should add jitter to delays */
  useJitter: boolean;
}
