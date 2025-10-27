import crypto from 'crypto';

/**
 * Normalize error strings by removing volatile tokens like:
 * - Request IDs (UUID patterns)
 * - Timestamps (ISO 8601, Unix timestamps, etc.)
 * - GUIDs and other hexadecimal IDs
 * - Session tokens
 * - Variable numbers in error messages
 * 
 * This ensures that identical errors with different IDs produce the same fingerprint.
 */
export function normalizeError(errorString: string): string {
  if (!errorString) return '';

  let normalized = errorString;

  // Replace UUIDs (8-4-4-4-12 format)
  normalized = normalized.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>');

  // Replace ISO 8601 timestamps
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?/g, '<TIMESTAMP>');

  // Replace Unix timestamps (10 or 13 digits)
  normalized = normalized.replace(/\b\d{10,13}\b/g, '<TIMESTAMP>');

  // Replace request IDs (common patterns like req_xxx, request-xxx, etc.) - 5+ chars
  normalized = normalized.replace(/\b(req|request|trace|correlation)[-_]?[a-z0-9]{5,}/gi, '<REQUEST_ID>');

  // Replace hex strings (16+ chars) that might be tokens
  normalized = normalized.replace(/\b[0-9a-f]{16,}\b/gi, '<HEX_TOKEN>');

  // Replace session IDs
  normalized = normalized.replace(/\b(session|sess|sid)[-_]?[a-z0-9]{8,}/gi, '<SESSION_ID>');

  // Replace IP addresses
  normalized = normalized.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<IP>');

  // Replace numbers in brackets or parentheses (often IDs or counts)
  normalized = normalized.replace(/[\[\(]\d+[\]\)]/g, '[N]');

  // Replace standalone numbers that aren't HTTP status codes
  normalized = normalized.replace(/\b(?![1-5]\d{2}\b)\d{4,}\b/g, '<NUM>');

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Extract hostname from a URL
 */
export function extractHost(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

/**
 * Normalize URL path by removing dynamic segments
 */
export function normalizePath(url: string): string {
  try {
    const urlObj = new URL(url);
    let path = urlObj.pathname;

    // Replace UUIDs in path
    path = path.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/|$)/gi, '/<UUID>$1');

    // Replace numeric IDs (3+ digits)
    path = path.replace(/\/\d{3,}(\/|$)/g, '/<ID>$1');

    // Replace hex tokens in path
    path = path.replace(/\/[0-9a-f]{16,}(\/|$)/gi, '/<TOKEN>$1');

    return path;
  } catch {
    return url;
  }
}

/**
 * Generate a fingerprint for a finding based on:
 * - Host
 * - Normalized path
 * - Normalized error string
 * - HTTP method
 * 
 * Returns a SHA-256 hash for deduplication.
 */
export interface FingerprintInput {
  url: string;
  error: string;
  method?: string;
  statusCode?: number;
}

export function generateFingerprint(input: FingerprintInput): string {
  const host = extractHost(input.url);
  const path = normalizePath(input.url);
  const normalizedError = normalizeError(input.error);
  const method = (input.method || 'GET').toUpperCase();
  
  // Include status code if it's a 5xx error (helps differentiate 500 vs 503)
  const statusPart = input.statusCode && input.statusCode >= 500 && input.statusCode < 600
    ? `:${input.statusCode}`
    : '';

  // Create a composite key
  const composite = `${host}|${path}|${method}|${normalizedError}${statusPart}`;

  // Generate SHA-256 hash
  return crypto.createHash('sha256').update(composite).digest('hex').substring(0, 32);
}

/**
 * Get a human-readable summary of the fingerprint components
 * Useful for debugging and display purposes
 */
export function getFingerprintSummary(input: FingerprintInput): {
  host: string;
  path: string;
  normalizedError: string;
  method: string;
  fingerprint: string;
} {
  const host = extractHost(input.url);
  const path = normalizePath(input.url);
  const normalizedError = normalizeError(input.error);
  const method = (input.method || 'GET').toUpperCase();
  const fingerprint = generateFingerprint(input);

  return {
    host,
    path,
    normalizedError,
    method,
    fingerprint,
  };
}
