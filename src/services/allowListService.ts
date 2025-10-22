import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

let allowListPatterns: RegExp[] = [];

/**
 * Convert wildcard pattern to regex
 * Supports * as wildcard
 */
function wildcardToRegex(pattern: string): RegExp {
  // Escape special regex characters except *
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  
  return new RegExp(`^${escaped}$`, 'i'); // Case-insensitive
}

/**
 * Load allow-list from CSV file
 */
export function loadAllowList(filePath?: string): void {
  const allowListPath =
    filePath || process.env.ALLOW_LIST_FILE || path.join(process.cwd(), 'src', 'config', 'allow-list.csv');

  try {
    logger.info(`[AllowList] Loading allow-list from: ${allowListPath}`);

    if (!fs.existsSync(allowListPath)) {
      logger.warn(`[AllowList] File not found: ${allowListPath}. Allow-list is empty.`);
      allowListPatterns = [];
      return;
    }

    const fileContent = fs.readFileSync(allowListPath, 'utf-8');
    const lines = fileContent.split('\n');

    allowListPatterns = lines
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')) // Remove empty lines and comments
      .map(pattern => {
        try {
          return wildcardToRegex(pattern);
        } catch (error) {
          logger.warn(`[AllowList] Invalid pattern "${pattern}": ${error}`);
          return null;
        }
      })
      .filter((regex): regex is RegExp => regex !== null);

    logger.info(`[AllowList] Loaded ${allowListPatterns.length} pattern(s)`);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error loading allow-list';
    logger.error(`[AllowList] Failed to load: ${errorMessage}`);
    allowListPatterns = [];
  }
}

/**
 * Check if URL is in the allow-list
 */
export function isUrlAllowed(url: string): boolean {
  // If no patterns loaded, allow all URLs by default
  if (allowListPatterns.length === 0) {
    return true;
  }

  // Check if URL matches any pattern
  for (const pattern of allowListPatterns) {
    if (pattern.test(url)) {
      logger.debug(`[AllowList] URL "${url}" matched pattern: ${pattern.source}`);
      return true;
    }
  }

  logger.debug(`[AllowList] URL "${url}" not in allow-list`);
  return false;
}

/**
 * Get current allow-list patterns (for admin endpoint)
 */
export function getAllowListPatterns(): string[] {
  return allowListPatterns.map(regex => regex.source);
}

/**
 * Reload allow-list from file
 */
export function reloadAllowList(): void {
  logger.info('[AllowList] Reloading allow-list...');
  loadAllowList();
}
