import { Redis } from 'ioredis';
import { logger } from '../utils/logger';

const ROBOTS_CACHE_PREFIX = 'robots:';
const ROBOTS_CACHE_TTL = 600; // 10 minutes

export interface RobotsTxtRules {
  disallowedPaths: string[];
  allowedPaths: string[];
  crawlDelay?: number;
}

/**
 * Parse robots.txt content
 */
function parseRobotsTxt(content: string, userAgent: string = '*'): RobotsTxtRules {
  const rules: RobotsTxtRules = {
    disallowedPaths: [],
    allowedPaths: [],
  };

  const lines = content.split('\n').map(line => line.trim());
  let isRelevantSection = false;

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line || line.startsWith('#')) {
      continue;
    }

    // Parse User-agent directive
    if (line.toLowerCase().startsWith('user-agent:')) {
      const agent = line.substring(11).trim();
      isRelevantSection = agent === '*' || agent.toLowerCase() === userAgent.toLowerCase();
      continue;
    }

    // Only process rules for relevant user-agent sections
    if (!isRelevantSection) {
      continue;
    }

    // Parse Disallow directive
    if (line.toLowerCase().startsWith('disallow:')) {
      const path = line.substring(9).trim();
      if (path) {
        rules.disallowedPaths.push(path);
      }
    }

    // Parse Allow directive
    if (line.toLowerCase().startsWith('allow:')) {
      const path = line.substring(6).trim();
      if (path) {
        rules.allowedPaths.push(path);
      }
    }

    // Parse Crawl-delay directive
    if (line.toLowerCase().startsWith('crawl-delay:')) {
      const delay = parseInt(line.substring(12).trim(), 10);
      if (!isNaN(delay)) {
        rules.crawlDelay = delay;
      }
    }
  }

  return rules;
}

/**
 * Fetch robots.txt for a domain
 */
async function fetchRobotsTxt(baseUrl: string): Promise<string | null> {
  try {
    const url = new URL('/robots.txt', baseUrl);
    
    logger.debug(`[Robots] Fetching robots.txt from: ${url.toString()}`);
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'UnleakBot/1.0',
      },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      logger.debug(`[Robots] robots.txt not found for ${baseUrl} (status: ${response.status})`);
      return null;
    }

    const content = await response.text();
    logger.debug(`[Robots] Successfully fetched robots.txt for ${baseUrl} (${content.length} bytes)`);
    
    return content;
  } catch (error) {
    logger.warn(`[Robots] Failed to fetch robots.txt for ${baseUrl}: ${error}`);
    return null;
  }
}

/**
 * Get domain from URL
 */
function getDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch (error) {
    logger.warn(`[Robots] Failed to parse URL "${url}": ${error}`);
    return url;
  }
}

/**
 * Get cached robots.txt rules or fetch and cache
 */
export async function getRobotsTxtRules(
  redis: Redis,
  url: string,
  userAgent: string = '*'
): Promise<RobotsTxtRules | null> {
  const domain = getDomain(url);
  const cacheKey = `${ROBOTS_CACHE_PREFIX}${domain}`;

  // Try to get from cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    logger.debug(`[Robots] Using cached robots.txt for ${domain}`);
    try {
      return JSON.parse(cached) as RobotsTxtRules;
    } catch (error) {
      logger.warn(`[Robots] Failed to parse cached robots.txt: ${error}`);
    }
  }

  // Fetch robots.txt
  const content = await fetchRobotsTxt(domain);
  if (!content) {
    // Cache null result to avoid repeated fetches
    await redis.setex(cacheKey, ROBOTS_CACHE_TTL, JSON.stringify(null));
    return null;
  }

  // Parse and cache
  const rules = parseRobotsTxt(content, userAgent);
  await redis.setex(cacheKey, ROBOTS_CACHE_TTL, JSON.stringify(rules));

  return rules;
}

/**
 * Check if URL path is allowed by robots.txt
 */
function isPathAllowed(path: string, rules: RobotsTxtRules): boolean {
  // Check if path matches any Allow directive (takes precedence)
  for (const allowedPath of rules.allowedPaths) {
    if (path.startsWith(allowedPath) || allowedPath === '/') {
      return true;
    }
  }

  // Check if path matches any Disallow directive
  for (const disallowedPath of rules.disallowedPaths) {
    if (disallowedPath === '/') {
      // Disallow all
      return false;
    }
    if (path.startsWith(disallowedPath)) {
      return false;
    }
  }

  // Default: allow if not explicitly disallowed
  return true;
}

/**
 * Check if URL is allowed by robots.txt
 */
export async function isAllowedByRobotsTxt(
  redis: Redis,
  url: string,
  userAgent: string = '*'
): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;

    const rules = await getRobotsTxtRules(redis, url, userAgent);
    
    // If no robots.txt found, allow by default
    if (!rules) {
      logger.debug(`[Robots] No robots.txt found for ${url}, allowing`);
      return true;
    }

    const allowed = isPathAllowed(path, rules);
    
    logger.debug(`[Robots] URL ${url} is ${allowed ? 'allowed' : 'disallowed'} by robots.txt`);
    
    return allowed;
  } catch (error) {
    logger.warn(`[Robots] Error checking robots.txt for ${url}: ${error}`);
    // On error, allow by default
    return true;
  }
}

/**
 * Get all cached robots.txt entries (for admin endpoint)
 */
export async function getAllCachedRobots(redis: Redis): Promise<Array<{
  domain: string;
  rules: RobotsTxtRules | null;
  ttl: number;
}>> {
  const keys = await redis.keys(`${ROBOTS_CACHE_PREFIX}*`);
  const entries = [];

  for (const key of keys) {
    const domain = key.replace(ROBOTS_CACHE_PREFIX, '');
    const [data, ttl] = await Promise.all([
      redis.get(key),
      redis.ttl(key),
    ]);

    if (data) {
      try {
        const rules = JSON.parse(data);
        entries.push({ domain, rules, ttl });
      } catch (error) {
        logger.warn(`[Robots] Failed to parse cached entry for ${domain}`);
      }
    }
  }

  return entries;
}

/**
 * Clear robots.txt cache for a domain
 */
export async function clearRobotsCache(redis: Redis, domain?: string): Promise<number> {
  if (domain) {
    const cacheKey = `${ROBOTS_CACHE_PREFIX}${domain}`;
    return await redis.del(cacheKey);
  }

  // Clear all robots.txt cache
  const keys = await redis.keys(`${ROBOTS_CACHE_PREFIX}*`);
  if (keys.length === 0) {
    return 0;
  }
  
  return await redis.del(...keys);
}
