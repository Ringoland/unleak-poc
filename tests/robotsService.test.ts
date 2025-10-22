import { 
  isAllowedByRobotsTxt,
  getRobotsTxtRules, 
  clearRobotsCache,
  getAllCachedRobots 
} from '../src/services/robotsService';
import { Redis } from 'ioredis';

// Mock dependencies
jest.mock('../src/utils/logger');

// Mock global fetch
global.fetch = jest.fn();
const mockedFetch = global.fetch as jest.MockedFunction<typeof fetch>;

// Mock Redis
const mockRedis = {
  get: jest.fn(),
  setex: jest.fn(),
  keys: jest.fn(),
  del: jest.fn(),
  ttl: jest.fn(),
} as unknown as Redis;

describe('Robots Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockRedis.get as jest.Mock).mockResolvedValue(null);
    (mockRedis.setex as jest.Mock).mockResolvedValue('OK');
    (mockRedis.keys as jest.Mock).mockResolvedValue([]);
    (mockRedis.del as jest.Mock).mockResolvedValue(1);
    (mockRedis.ttl as jest.Mock).mockResolvedValue(600);
  });

  describe('isAllowedByRobotsTxt', () => {
    it('should allow crawling when robots.txt allows', async () => {
      const robotsTxt = `User-agent: *
Disallow: /admin
Allow: /api`;

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      const result = await isAllowedByRobotsTxt(mockRedis, 'https://example.com/api/users');
      expect(result).toBe(true);
    });

    it('should disallow crawling when robots.txt disallows', async () => {
      const robotsTxt = `User-agent: *
Disallow: /admin`;

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      const result = await isAllowedByRobotsTxt(mockRedis, 'https://example.com/admin/users');
      expect(result).toBe(false);
    });

    it('should handle wildcard disallow pattern', async () => {
      const robotsTxt = `User-agent: *
Disallow: /private/`;

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      const result = await isAllowedByRobotsTxt(mockRedis, 'https://example.com/private/data');
      expect(result).toBe(false);
    });

    it('should allow crawling when robots.txt is not found (404)', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const result = await isAllowedByRobotsTxt(mockRedis, 'https://example.com/any/path');
      expect(result).toBe(true);
    });

    it('should allow crawling when fetch fails', async () => {
      mockedFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await isAllowedByRobotsTxt(mockRedis, 'https://example.com/any/path');
      expect(result).toBe(true);
    });

    it('should cache robots.txt rules in Redis', async () => {
      const robotsTxt = `User-agent: *
Disallow: /admin`;

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      await isAllowedByRobotsTxt(mockRedis, 'https://example.com/api');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'robots:https://example.com',
        600,
        expect.any(String)
      );
    });

    it('should use cached robots.txt when available', async () => {
      const cachedRules = JSON.stringify({
        disallowedPaths: ['/admin'],
        allowedPaths: [],
      });

      (mockRedis.get as jest.Mock).mockResolvedValueOnce(cachedRules);

      const result = await isAllowedByRobotsTxt(mockRedis, 'https://example.com/api');
      
      expect(result).toBe(true);
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('should handle empty robots.txt', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => '',
      } as Response);

      const result = await isAllowedByRobotsTxt(mockRedis, 'https://example.com/any/path');
      expect(result).toBe(true);
    });

    it('should respect Allow directive over Disallow', async () => {
      const robotsTxt = `User-agent: *
Disallow: /api
Allow: /api/public`;

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      const result = await isAllowedByRobotsTxt(mockRedis, 'https://example.com/api/public/data');
      expect(result).toBe(true);
    });

    it('should fetch robots.txt with correct URL', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'User-agent: *\nAllow: /',
      } as Response);

      await isAllowedByRobotsTxt(mockRedis, 'https://example.com/deep/path/to/resource');

      expect(mockedFetch).toHaveBeenCalledWith(
        'https://example.com/robots.txt',
        expect.any(Object)
      );
    });

    it('should handle URLs with ports', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'User-agent: *\nAllow: /',
      } as Response);

      await isAllowedByRobotsTxt(mockRedis, 'https://example.com:8080/api/users');

      expect(mockedFetch).toHaveBeenCalledWith(
        'https://example.com/robots.txt',
        expect.any(Object)
      );
    });

    it('should handle multiple user agents', async () => {
      const robotsTxt = `User-agent: BadBot
Disallow: /

User-agent: *
Allow: /`;

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      const result = await isAllowedByRobotsTxt(mockRedis, 'https://example.com/any/path', 'UnleakBot');
      expect(result).toBe(true);
    });
  });

  describe('getRobotsTxtRules', () => {
    it('should return parsed rules from robots.txt', async () => {
      const robotsTxt = `User-agent: *
Crawl-delay: 5
Disallow: /admin
Allow: /api`;

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      const rules = await getRobotsTxtRules(mockRedis, 'https://example.com/api');
      
      expect(rules).toEqual({
        disallowedPaths: ['/admin'],
        allowedPaths: ['/api'],
        crawlDelay: 5,
      });
    });

    it('should return null when robots.txt not found', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const rules = await getRobotsTxtRules(mockRedis, 'https://example.com/api');
      expect(rules).toBeNull();
    });

    it('should cache null result when robots.txt not found', async () => {
      mockedFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      await getRobotsTxtRules(mockRedis, 'https://example.com/api');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'robots:https://example.com',
        600,
        'null'
      );
    });

    it('should use cached rules', async () => {
      const cachedRules = JSON.stringify({
        disallowedPaths: ['/admin'],
        allowedPaths: [],
        crawlDelay: 3,
      });

      (mockRedis.get as jest.Mock).mockResolvedValueOnce(cachedRules);

      const rules = await getRobotsTxtRules(mockRedis, 'https://example.com/api');
      
      expect(rules).toEqual({
        disallowedPaths: ['/admin'],
        allowedPaths: [],
        crawlDelay: 3,
      });
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('should handle crawl delay parsing', async () => {
      const robotsTxt = `User-agent: *
Crawl-delay: 2
Disallow: /admin`;

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      const rules = await getRobotsTxtRules(mockRedis, 'https://example.com/api');
      expect(rules?.crawlDelay).toBe(2);
    });

    it('should ignore invalid crawl delay', async () => {
      const robotsTxt = `User-agent: *
Crawl-delay: invalid
Disallow: /admin`;

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      const rules = await getRobotsTxtRules(mockRedis, 'https://example.com/api');
      expect(rules?.crawlDelay).toBeUndefined();
    });

    it('should skip comments and empty lines', async () => {
      const robotsTxt = `# This is a comment
User-agent: *

Disallow: /admin
# Another comment
Allow: /api`;

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      const rules = await getRobotsTxtRules(mockRedis, 'https://example.com/api');
      expect(rules?.disallowedPaths).toEqual(['/admin']);
      expect(rules?.allowedPaths).toEqual(['/api']);
    });
  });

  describe('getAllCachedRobots', () => {
    it('should return all cached robots entries', async () => {
      const keys = ['robots:https://example.com', 'robots:https://other.com'];
      const rules1 = JSON.stringify({ disallowedPaths: ['/admin'], allowedPaths: [] });
      const rules2 = JSON.stringify({ disallowedPaths: ['/private'], allowedPaths: [] });

      (mockRedis.keys as jest.Mock).mockResolvedValueOnce(keys);
      (mockRedis.get as jest.Mock)
        .mockResolvedValueOnce(rules1)
        .mockResolvedValueOnce(rules2);
      (mockRedis.ttl as jest.Mock)
        .mockResolvedValueOnce(500)
        .mockResolvedValueOnce(300);

      const entries = await getAllCachedRobots(mockRedis);

      expect(entries.length).toBe(2);
      expect(entries[0].domain).toBe('https://example.com');
      expect(entries[0].ttl).toBe(500);
      expect(entries[1].domain).toBe('https://other.com');
      expect(entries[1].ttl).toBe(300);
    });

    it('should return empty array when no cached entries', async () => {
      (mockRedis.keys as jest.Mock).mockResolvedValueOnce([]);

      const entries = await getAllCachedRobots(mockRedis);
      expect(entries).toEqual([]);
    });

    it('should handle parse errors gracefully', async () => {
      const keys = ['robots:https://example.com'];
      
      (mockRedis.keys as jest.Mock).mockResolvedValueOnce(keys);
      (mockRedis.get as jest.Mock).mockResolvedValueOnce('invalid json');
      (mockRedis.ttl as jest.Mock).mockResolvedValueOnce(500);

      const entries = await getAllCachedRobots(mockRedis);
      expect(entries).toEqual([]);
    });
  });

  describe('clearRobotsCache', () => {
    it('should clear cache for specific domain', async () => {
      await clearRobotsCache(mockRedis, 'https://example.com');

      expect(mockRedis.del).toHaveBeenCalledWith('robots:https://example.com');
    });

    it('should clear all robots cache when no domain specified', async () => {
      const keys = ['robots:https://example.com', 'robots:https://other.com'];
      (mockRedis.keys as jest.Mock).mockResolvedValueOnce(keys);

      await clearRobotsCache(mockRedis);

      expect(mockRedis.del).toHaveBeenCalledWith(...keys);
    });

    it('should return 0 when no keys to delete', async () => {
      (mockRedis.keys as jest.Mock).mockResolvedValueOnce([]);

      const result = await clearRobotsCache(mockRedis);
      expect(result).toBe(0);
    });
  });

  describe('Path matching logic', () => {
    it('should match exact paths', async () => {
      const robotsTxt = `User-agent: *
Disallow: /admin.html`;

      // Need fresh mock for each test
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(null);
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      expect(await isAllowedByRobotsTxt(mockRedis, 'https://example.com/admin.html')).toBe(false);
      
      // Use cached result
      const cachedRules = JSON.stringify({
        disallowedPaths: ['/admin.html'],
        allowedPaths: [],
      });
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(cachedRules);
      expect(await isAllowedByRobotsTxt(mockRedis, 'https://example.com/admin')).toBe(true);
    });

    it('should match prefix patterns', async () => {
      const robotsTxt = `User-agent: *
Disallow: /api`;

      (mockRedis.get as jest.Mock).mockResolvedValueOnce(null);
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      expect(await isAllowedByRobotsTxt(mockRedis, 'https://test.com/api')).toBe(false);
      
      // Use cached result for same domain
      const cachedRules = JSON.stringify({
        disallowedPaths: ['/api'],
        allowedPaths: [],
      });
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(cachedRules);
      expect(await isAllowedByRobotsTxt(mockRedis, 'https://test.com/api/users')).toBe(false);
      
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(cachedRules);
      expect(await isAllowedByRobotsTxt(mockRedis, 'https://test.com/api-docs')).toBe(false);
    });

    it('should match directory patterns', async () => {
      const robotsTxt = `User-agent: *
Disallow: /admin/`;

      (mockRedis.get as jest.Mock).mockResolvedValueOnce(null);
      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      expect(await isAllowedByRobotsTxt(mockRedis, 'https://site.com/admin/')).toBe(false);
      
      const cachedRules = JSON.stringify({
        disallowedPaths: ['/admin/'],
        allowedPaths: [],
      });
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(cachedRules);
      expect(await isAllowedByRobotsTxt(mockRedis, 'https://site.com/admin/users')).toBe(false);
    });

    it('should handle Disallow: / (block all)', async () => {
      const robotsTxt = `User-agent: *
Disallow: /`;

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      expect(await isAllowedByRobotsTxt(mockRedis, 'https://example.com/any/path')).toBe(false);
    });

    it('should include query parameters in path check', async () => {
      const robotsTxt = `User-agent: *
Disallow: /search?`;

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => robotsTxt,
      } as Response);

      expect(await isAllowedByRobotsTxt(mockRedis, 'https://example.com/search?q=test')).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should handle fetch timeout', async () => {
      mockedFetch.mockRejectedValueOnce(new Error('AbortError'));

      const result = await isAllowedByRobotsTxt(mockRedis, 'https://example.com/api');
      expect(result).toBe(true); // Allow on timeout
    });

    it('should handle network errors', async () => {
      mockedFetch.mockRejectedValueOnce({ code: 'ECONNREFUSED' });

      const result = await isAllowedByRobotsTxt(mockRedis, 'https://example.com/api');
      expect(result).toBe(true); // Allow on error
    });

    it('should handle invalid URLs gracefully', async () => {
      const result = await isAllowedByRobotsTxt(mockRedis, 'not-a-valid-url');
      expect(result).toBe(true); // Allow on parse error
    });

    it('should handle corrupt cached data', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValueOnce('invalid json');

      mockedFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'User-agent: *\nDisallow: /admin',
      } as Response);

      const result = await isAllowedByRobotsTxt(mockRedis, 'https://example.com/api');
      expect(result).toBe(true); // Should fetch fresh data
    });
  });
});
