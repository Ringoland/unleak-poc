import { config } from '../config';

/**
 * Get the base URL for the Unleak PoC API.
 * Defaults to http://localhost:8000 for local development.
 * 
 * @param customHost - Optional custom host (e.g., 'production.example.com')
 * @param customPort - Optional custom port (defaults to config.port or 8000)
 * @returns The full base URL (e.g., 'http://localhost:8000')
 */
export function getBaseUrl(customHost?: string, customPort?: number): string {
  const host = customHost || 'localhost';
  const port = customPort || config.port || 8000;
  const protocol = host === 'localhost' ? 'http' : 'https';
  
  return `${protocol}://${host}:${port}`;
}

/**
 * Get the default base URL for local development.
 * Always returns http://localhost:8000 regardless of config.
 * 
 * @returns 'http://localhost:8000'
 */
export function getDefaultBaseUrl(): string {
  return 'http://localhost:8000';
}
