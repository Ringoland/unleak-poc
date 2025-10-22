import crypto from 'crypto';
import { URL } from 'url';
import { logger } from '../utils/logger';

/**
 * Normalize URL for consistent fingerprinting
 * Removes query params, fragments, and trailing slashes
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    
    // Use protocol + hostname + pathname (no query, no fragment)
    // Remove trailing slash from pathname
    const pathname = parsed.pathname.replace(/\/$/, '') || '/';
    
    const normalized = `${parsed.protocol}//${parsed.hostname}${pathname}`;
    
    logger.debug(`[Fingerprint] Normalized URL: ${url} -> ${normalized}`);
    
    return normalized;
  } catch (error) {
    logger.warn(`[Fingerprint] Failed to parse URL "${url}": ${error}`);
    // If URL parsing fails, return as-is
    return url;
  }
}

/**
 * Normalize error message for consistent fingerprinting
 * Removes dynamic parts like timestamps, IDs, memory addresses
 */
export function normalizeError(errorMessage: string): string {
  if (!errorMessage) {
    return '';
  }

  let normalized = errorMessage;

  // Remove timestamps (ISO 8601 format)
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z/g, '[TIMESTAMP]');
  
  // Remove UUIDs
  normalized = normalized.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[UUID]');
  
  // Remove hex addresses (e.g., 0x7f8b1c2d3e4f)
  normalized = normalized.replace(/0x[0-9a-f]+/gi, '[ADDRESS]');
  
  // Remove numeric IDs (e.g., "ID: 12345")
  normalized = normalized.replace(/\b(id|ID|Id):\s*\d+/g, '$1:[ID]');
  
  // Remove file paths with line numbers (e.g., /path/to/file.ts:123)
  normalized = normalized.replace(/\/[^\s:]+:\d+/g, '[PATH:LINE]');
  
  // Remove stack trace memory addresses
  normalized = normalized.replace(/at\s+0x[0-9a-f]+/gi, 'at [ADDRESS]');
  
  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  logger.debug(`[Fingerprint] Normalized error: ${errorMessage} -> ${normalized}`);

  return normalized;
}

/**
 * Generate SHA256 fingerprint for a finding
 * Combines normalized URL, status code, and normalized error message
 */
export function generateFingerprint(
  url: string,
  statusCode?: number,
  errorMessage?: string
): string {
  const normalizedUrl = normalizeUrl(url);
  const normalizedError = errorMessage ? normalizeError(errorMessage) : '';
  
  // Create fingerprint input: URL + status + error
  const fingerprintInput = [
    normalizedUrl,
    statusCode?.toString() || 'NO_STATUS',
    normalizedError || 'NO_ERROR',
  ].join('::');

  // Generate SHA256 hash
  const hash = crypto
    .createHash('sha256')
    .update(fingerprintInput)
    .digest('hex');

  logger.debug(`[Fingerprint] Generated: ${hash.substring(0, 16)}... for "${normalizedUrl}"`);

  return hash;
}

/**
 * Generate fingerprint for network timeout
 */
export function generateTimeoutFingerprint(url: string): string {
  return generateFingerprint(url, undefined, 'TIMEOUT');
}

/**
 * Generate fingerprint for network error
 */
export function generateNetworkErrorFingerprint(url: string, errorMessage: string): string {
  return generateFingerprint(url, undefined, errorMessage);
}

/**
 * Generate fingerprint for HTTP status code
 */
export function generateHttpErrorFingerprint(url: string, statusCode: number): string {
  return generateFingerprint(url, statusCode, undefined);
}

/**
 * Generate fingerprint for latency issue
 */
export function generateLatencyFingerprint(url: string, latencyMs: number): string {
  return generateFingerprint(url, undefined, `LATENCY_${Math.floor(latencyMs / 100) * 100}ms`);
}
