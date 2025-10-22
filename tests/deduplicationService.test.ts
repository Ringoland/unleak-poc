import {
  isWithinCooldown,
  getFingerprint,
  storeFingerprint,
  setCooldown,
  checkDeduplication,
  recordFinding,
  getAllFingerprints,
  getCooldownStats,
  FingerprintData,
} from '../src/services/deduplicationService';
import { Redis } from 'ioredis';
import type { Rule } from '../src/services/rulesService';

// Mock dependencies
jest.mock('../src/utils/logger');
jest.mock('../src/services/rulesService', () => ({
  getEffectiveCooldown: jest.fn((rule: Rule | null) => rule?.cooldownSeconds || 300),
}));

// Mock Redis
const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  exists: jest.fn(),
  ttl: jest.fn(),
  keys: jest.fn(),
} as unknown as Redis;

describe('Deduplication Service', () => {
  const testFingerprint = 'abcd1234efgh5678';
  const testUrl = 'https://example.com/api/users';
  const mockRule: Rule = {
    id: 'test-rule',
    pattern: '*.example.com',
    cooldownSeconds: 600,
    respectRobots: true,
    latencyMsThreshold: 5000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (mockRedis.get as jest.Mock).mockResolvedValue(null);
    (mockRedis.set as jest.Mock).mockResolvedValue('OK');
    (mockRedis.setex as jest.Mock).mockResolvedValue('OK');
    (mockRedis.exists as jest.Mock).mockResolvedValue(0);
    (mockRedis.ttl as jest.Mock).mockResolvedValue(-2);
    (mockRedis.keys as jest.Mock).mockResolvedValue([]);
  });

  describe('isWithinCooldown', () => {
    it('should return true when cooldown exists', async () => {
      (mockRedis.exists as jest.Mock).mockResolvedValueOnce(1);
      (mockRedis.ttl as jest.Mock).mockResolvedValueOnce(300);

      const result = await isWithinCooldown(mockRedis, testFingerprint, mockRule);
      
      expect(result).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith(`cooldown:${testFingerprint}`);
    });

    it('should return false when cooldown does not exist', async () => {
      (mockRedis.exists as jest.Mock).mockResolvedValueOnce(0);

      const result = await isWithinCooldown(mockRedis, testFingerprint, mockRule);
      
      expect(result).toBe(false);
    });

    it('should check correct cooldown key', async () => {
      await isWithinCooldown(mockRedis, testFingerprint, mockRule);

      expect(mockRedis.exists).toHaveBeenCalledWith(`cooldown:${testFingerprint}`);
    });
  });

  describe('getFingerprint', () => {
    it('should return fingerprint data when it exists', async () => {
      const fingerprintData: FingerprintData = {
        fingerprint: testFingerprint,
        url: testUrl,
        firstSeenAt: 1000000,
        lastSeenAt: 1000000,
        occurrenceCount: 1,
      };

      (mockRedis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(fingerprintData));

      const result = await getFingerprint(mockRedis, testFingerprint);
      
      expect(result).toEqual(fingerprintData);
      expect(mockRedis.get).toHaveBeenCalledWith(`fingerprint:${testFingerprint}`);
    });

    it('should return null when fingerprint does not exist', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(null);

      const result = await getFingerprint(mockRedis, testFingerprint);
      
      expect(result).toBeNull();
    });

    it('should return null on parse error', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValueOnce('invalid json');

      const result = await getFingerprint(mockRedis, testFingerprint);
      
      expect(result).toBeNull();
    });

    it('should use correct fingerprint key', async () => {
      await getFingerprint(mockRedis, testFingerprint);

      expect(mockRedis.get).toHaveBeenCalledWith(`fingerprint:${testFingerprint}`);
    });
  });

  describe('storeFingerprint', () => {
    it('should create new fingerprint when it does not exist', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(null);
      
      const result = await storeFingerprint(
        mockRedis,
        testFingerprint,
        testUrl,
        404,
        'Not Found'
      );

      expect(result.fingerprint).toBe(testFingerprint);
      expect(result.url).toBe(testUrl);
      expect(result.occurrenceCount).toBe(1);
      expect(result.statusCode).toBe(404);
      expect(result.errorMessage).toBe('Not Found');
      expect(result.firstSeenAt).toBeDefined();
      expect(result.lastSeenAt).toBeDefined();
    });

    it('should update existing fingerprint', async () => {
      const existing: FingerprintData = {
        fingerprint: testFingerprint,
        url: testUrl,
        firstSeenAt: 1000000,
        lastSeenAt: 1000000,
        occurrenceCount: 1,
      };

      (mockRedis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(existing));

      const result = await storeFingerprint(mockRedis, testFingerprint, testUrl);

      expect(result.occurrenceCount).toBe(2);
      expect(result.firstSeenAt).toBe(existing.firstSeenAt);
      expect(result.lastSeenAt).toBeGreaterThan(existing.lastSeenAt);
    });

    it('should persist fingerprint data to Redis', async () => {
      await storeFingerprint(mockRedis, testFingerprint, testUrl);

      expect(mockRedis.set).toHaveBeenCalledWith(
        `fingerprint:${testFingerprint}`,
        expect.any(String)
      );
    });

    it('should handle status code and error message', async () => {
      const result = await storeFingerprint(
        mockRedis,
        testFingerprint,
        testUrl,
        500,
        'Internal Server Error'
      );

      expect(result.statusCode).toBe(500);
      expect(result.errorMessage).toBe('Internal Server Error');
    });

    it('should increment occurrence count on each call', async () => {
      // First call
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(null);
      const first = await storeFingerprint(mockRedis, testFingerprint, testUrl);
      expect(first.occurrenceCount).toBe(1);

      // Second call
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(first));
      const second = await storeFingerprint(mockRedis, testFingerprint, testUrl);
      expect(second.occurrenceCount).toBe(2);

      // Third call
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(second));
      const third = await storeFingerprint(mockRedis, testFingerprint, testUrl);
      expect(third.occurrenceCount).toBe(3);
    });
  });

  describe('setCooldown', () => {
    it('should set cooldown with correct duration from rule', async () => {
      await setCooldown(mockRedis, testFingerprint, mockRule);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `cooldown:${testFingerprint}`,
        600,
        expect.any(String)
      );
    });

    it('should use default cooldown when rule is null', async () => {
      await setCooldown(mockRedis, testFingerprint, null);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `cooldown:${testFingerprint}`,
        300,
        expect.any(String)
      );
    });

    it('should use correct cooldown key', async () => {
      await setCooldown(mockRedis, testFingerprint, mockRule);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `cooldown:${testFingerprint}`,
        expect.any(Number),
        expect.any(String)
      );
    });
  });

  describe('checkDeduplication', () => {
    it('should return suppressed=false when not in cooldown', async () => {
      (mockRedis.exists as jest.Mock).mockResolvedValueOnce(0);

      const result = await checkDeduplication(mockRedis, testFingerprint, mockRule);

      expect(result.suppressed).toBe(false);
      expect(result.reason).toBeUndefined();
      expect(result.data).toBeUndefined();
    });

    it('should return suppressed=true when in cooldown', async () => {
      (mockRedis.exists as jest.Mock).mockResolvedValueOnce(1);
      (mockRedis.ttl as jest.Mock).mockResolvedValueOnce(300);

      const fingerprintData: FingerprintData = {
        fingerprint: testFingerprint,
        url: testUrl,
        firstSeenAt: 1000000,
        lastSeenAt: 1000000,
        occurrenceCount: 3,
      };
      
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(fingerprintData));

      const result = await checkDeduplication(mockRedis, testFingerprint, mockRule);

      expect(result.suppressed).toBe(true);
      expect(result.reason).toBe('cooldown');
      expect(result.data).toEqual(fingerprintData);
    });

    it('should include fingerprint data when suppressed', async () => {
      (mockRedis.exists as jest.Mock).mockResolvedValueOnce(1);
      (mockRedis.ttl as jest.Mock).mockResolvedValueOnce(300);

      const fingerprintData: FingerprintData = {
        fingerprint: testFingerprint,
        url: testUrl,
        firstSeenAt: 1000000,
        lastSeenAt: 1000000,
        occurrenceCount: 5,
      };
      
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(fingerprintData));

      const result = await checkDeduplication(mockRedis, testFingerprint, mockRule);

      expect(result.data?.occurrenceCount).toBe(5);
    });
  });

  describe('recordFinding', () => {
    it('should store fingerprint and set cooldown', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(null);

      const result = await recordFinding(
        mockRedis,
        testFingerprint,
        testUrl,
        mockRule,
        404,
        'Not Found'
      );

      expect(result.fingerprint).toBe(testFingerprint);
      expect(result.url).toBe(testUrl);
      expect(result.occurrenceCount).toBe(1);
      
      expect(mockRedis.set).toHaveBeenCalled();
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `cooldown:${testFingerprint}`,
        600,
        expect.any(String)
      );
    });

    it('should increment count for existing fingerprint', async () => {
      const existing: FingerprintData = {
        fingerprint: testFingerprint,
        url: testUrl,
        firstSeenAt: 1000000,
        lastSeenAt: 1000000,
        occurrenceCount: 2,
      };

      (mockRedis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(existing));

      const result = await recordFinding(mockRedis, testFingerprint, testUrl, mockRule);

      expect(result.occurrenceCount).toBe(3);
    });

    it('should return fingerprint data', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(null);

      const result = await recordFinding(mockRedis, testFingerprint, testUrl, mockRule);

      expect(result.fingerprint).toBe(testFingerprint);
      expect(result.url).toBe(testUrl);
      expect(result.firstSeenAt).toBeDefined();
      expect(result.lastSeenAt).toBeDefined();
    });

    it('should handle optional status code and error message', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(null);

      const result = await recordFinding(
        mockRedis,
        testFingerprint,
        testUrl,
        mockRule,
        500,
        'Server Error'
      );

      expect(result.statusCode).toBe(500);
      expect(result.errorMessage).toBe('Server Error');
    });
  });

  describe('getAllFingerprints', () => {
    it('should return all fingerprints sorted by lastSeenAt', async () => {
      const fingerprints = [
        {
          fingerprint: 'fp1',
          url: 'url1',
          firstSeenAt: 1000000,
          lastSeenAt: 1000000,
          occurrenceCount: 1,
        },
        {
          fingerprint: 'fp2',
          url: 'url2',
          firstSeenAt: 2000000,
          lastSeenAt: 3000000,
          occurrenceCount: 2,
        },
        {
          fingerprint: 'fp3',
          url: 'url3',
          firstSeenAt: 1500000,
          lastSeenAt: 2000000,
          occurrenceCount: 3,
        },
      ];

      (mockRedis.keys as jest.Mock).mockResolvedValueOnce([
        'fingerprint:fp1',
        'fingerprint:fp2',
        'fingerprint:fp3',
      ]);

      (mockRedis.get as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify(fingerprints[0]))
        .mockResolvedValueOnce(JSON.stringify(fingerprints[1]))
        .mockResolvedValueOnce(JSON.stringify(fingerprints[2]));

      const result = await getAllFingerprints(mockRedis);

      expect(result.length).toBe(3);
      // Should be sorted by lastSeenAt descending
      expect(result[0].fingerprint).toBe('fp2'); // lastSeenAt: 3000000
      expect(result[1].fingerprint).toBe('fp3'); // lastSeenAt: 2000000
      expect(result[2].fingerprint).toBe('fp1'); // lastSeenAt: 1000000
    });

    it('should return empty array when no fingerprints', async () => {
      (mockRedis.keys as jest.Mock).mockResolvedValueOnce([]);

      const result = await getAllFingerprints(mockRedis);

      expect(result).toEqual([]);
    });

    it('should skip fingerprints with parse errors', async () => {
      (mockRedis.keys as jest.Mock).mockResolvedValueOnce([
        'fingerprint:fp1',
        'fingerprint:fp2',
      ]);

      (mockRedis.get as jest.Mock)
        .mockResolvedValueOnce('invalid json')
        .mockResolvedValueOnce(JSON.stringify({
          fingerprint: 'fp2',
          url: 'url2',
          firstSeenAt: 1000000,
          lastSeenAt: 1000000,
          occurrenceCount: 1,
        }));

      const result = await getAllFingerprints(mockRedis);

      expect(result.length).toBe(1);
      expect(result[0].fingerprint).toBe('fp2');
    });

    it('should query correct Redis keys', async () => {
      await getAllFingerprints(mockRedis);

      expect(mockRedis.keys).toHaveBeenCalledWith('fingerprint:*');
    });
  });

  describe('getCooldownStats', () => {
    it('should return correct statistics', async () => {
      (mockRedis.keys as jest.Mock)
        .mockResolvedValueOnce(['cooldown:fp1', 'cooldown:fp2'])
        .mockResolvedValueOnce(['fingerprint:fp1', 'fingerprint:fp2', 'fingerprint:fp3']);

      const result = await getCooldownStats(mockRedis);

      expect(result.activeCooldowns).toBe(2);
      expect(result.totalFingerprints).toBe(3);
    });

    it('should return zero counts when no data', async () => {
      (mockRedis.keys as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await getCooldownStats(mockRedis);

      expect(result.activeCooldowns).toBe(0);
      expect(result.totalFingerprints).toBe(0);
    });

    it('should query correct Redis key patterns', async () => {
      await getCooldownStats(mockRedis);

      expect(mockRedis.keys).toHaveBeenCalledWith('cooldown:*');
      expect(mockRedis.keys).toHaveBeenCalledWith('fingerprint:*');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete finding lifecycle', async () => {
      // First occurrence - not in cooldown
      (mockRedis.exists as jest.Mock).mockResolvedValueOnce(0);
      const dedupCheck1 = await checkDeduplication(mockRedis, testFingerprint, mockRule);
      expect(dedupCheck1.suppressed).toBe(false);

      // Record the finding
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(null);
      const recorded = await recordFinding(mockRedis, testFingerprint, testUrl, mockRule);
      expect(recorded.occurrenceCount).toBe(1);

      // Second occurrence - should be in cooldown
      (mockRedis.exists as jest.Mock).mockResolvedValueOnce(1);
      (mockRedis.ttl as jest.Mock).mockResolvedValueOnce(300);
      (mockRedis.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(recorded));
      
      const dedupCheck2 = await checkDeduplication(mockRedis, testFingerprint, mockRule);
      expect(dedupCheck2.suppressed).toBe(true);
      expect(dedupCheck2.reason).toBe('cooldown');
    });

    it('should track multiple occurrences correctly', async () => {
      let currentData: FingerprintData | null = null;

      for (let i = 0; i < 5; i++) {
        (mockRedis.get as jest.Mock).mockResolvedValueOnce(
          currentData ? JSON.stringify(currentData) : null
        );
        
        currentData = await storeFingerprint(mockRedis, testFingerprint, testUrl);
        expect(currentData.occurrenceCount).toBe(i + 1);
      }
    });
  });
});
