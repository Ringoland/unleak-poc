import {
  normalizeUrl,
  normalizeError,
  generateFingerprint,
  generateTimeoutFingerprint,
  generateNetworkErrorFingerprint,
  generateHttpErrorFingerprint,
  generateLatencyFingerprint,
} from '../src/services/fingerprintService';

describe('Fingerprinting Service', () => {
  describe('normalizeUrl', () => {
    it('should remove query parameters', () => {
      const url = 'https://example.com/api?foo=bar&baz=qux';
      const normalized = normalizeUrl(url);
      expect(normalized).toBe('https://example.com/api');
    });

    it('should remove fragments', () => {
      const url = 'https://example.com/page#section';
      const normalized = normalizeUrl(url);
      expect(normalized).toBe('https://example.com/page');
    });

    it('should remove trailing slashes', () => {
      const url = 'https://example.com/api/';
      const normalized = normalizeUrl(url);
      expect(normalized).toBe('https://example.com/api');
    });

    it('should handle root path', () => {
      const url = 'https://example.com/';
      const normalized = normalizeUrl(url);
      expect(normalized).toBe('https://example.com/');
    });

    it('should normalize complex URLs consistently', () => {
      const url1 = 'https://example.com/api/?foo=1#hash';
      const url2 = 'https://example.com/api?bar=2';
      const url3 = 'https://example.com/api/';
      
      const norm1 = normalizeUrl(url1);
      const norm2 = normalizeUrl(url2);
      const norm3 = normalizeUrl(url3);
      
      expect(norm1).toBe(norm2);
      expect(norm2).toBe(norm3);
    });

    it('should handle invalid URLs gracefully', () => {
      const invalidUrl = 'not-a-valid-url';
      const normalized = normalizeUrl(invalidUrl);
      expect(normalized).toBe(invalidUrl); // Returns as-is on error
    });
  });

  describe('normalizeError', () => {
    it('should remove ISO 8601 timestamps', () => {
      const error = 'Error at 2025-01-01T10:00:00.123Z occurred';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Error at [TIMESTAMP] occurred');
    });

    it('should remove UUIDs', () => {
      const error = 'Request a1b2c3d4-e5f6-4789-a012-123456789abc failed';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Request [UUID] failed');
    });

    it('should remove hex addresses', () => {
      const error = 'Memory address: 0x7f8b1c2d3e4f';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Memory address: [ADDRESS]');
    });

    it('should remove numeric IDs', () => {
      const error = 'User ID: 12345 not found';
      const normalized = normalizeError(error);
      expect(normalized).toBe('User ID:[ID] not found');
    });

    it('should remove file paths with line numbers', () => {
      const error = 'Error at /path/to/file.ts:123';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Error at [PATH:LINE]');
    });

    it('should normalize whitespace', () => {
      const error = 'Error   with    extra   spaces';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Error with extra spaces');
    });

    it('should handle empty string', () => {
      const normalized = normalizeError('');
      expect(normalized).toBe('');
    });
  });

  describe('generateFingerprint', () => {
    it('should generate consistent SHA256 hash for same inputs', () => {
      const fp1 = generateFingerprint('https://example.com/api', 500, 'Server Error');
      const fp2 = generateFingerprint('https://example.com/api', 500, 'Server Error');
      expect(fp1).toBe(fp2);
    });

    it('should generate different hashes for different URLs', () => {
      const fp1 = generateFingerprint('https://example.com/api1', 500, 'Error');
      const fp2 = generateFingerprint('https://example.com/api2', 500, 'Error');
      expect(fp1).not.toBe(fp2);
    });

    it('should generate different hashes for different status codes', () => {
      const fp1 = generateFingerprint('https://example.com/api', 500, 'Error');
      const fp2 = generateFingerprint('https://example.com/api', 502, 'Error');
      expect(fp1).not.toBe(fp2);
    });

    it('should generate different hashes for different errors', () => {
      const fp1 = generateFingerprint('https://example.com/api', 500, 'Error A');
      const fp2 = generateFingerprint('https://example.com/api', 500, 'Error B');
      expect(fp1).not.toBe(fp2);
    });

    it('should return 64-character hex string', () => {
      const fp = generateFingerprint('https://example.com/api', 500, 'Error');
      expect(fp).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should normalize URLs before hashing', () => {
      const fp1 = generateFingerprint('https://example.com/api?foo=bar', 500, 'Error');
      const fp2 = generateFingerprint('https://example.com/api?baz=qux', 500, 'Error');
      expect(fp1).toBe(fp2); // Same after normalization
    });

    it('should normalize errors before hashing', () => {
      const fp1 = generateFingerprint(
        'https://example.com/api',
        500,
        'Error at 2025-01-01T10:00:00Z'
      );
      const fp2 = generateFingerprint(
        'https://example.com/api',
        500,
        'Error at 2025-12-31T23:59:59Z'
      );
      expect(fp1).toBe(fp2); // Same after normalization
    });
  });

  describe('generateTimeoutFingerprint', () => {
    it('should generate consistent fingerprint for timeouts', () => {
      const fp1 = generateTimeoutFingerprint('https://example.com/api');
      const fp2 = generateTimeoutFingerprint('https://example.com/api');
      expect(fp1).toBe(fp2);
    });

    it('should differ from other error types', () => {
      const fpTimeout = generateTimeoutFingerprint('https://example.com/api');
      const fpNetwork = generateNetworkErrorFingerprint('https://example.com/api', 'Network error');
      expect(fpTimeout).not.toBe(fpNetwork);
    });
  });

  describe('generateNetworkErrorFingerprint', () => {
    it('should generate consistent fingerprint for same network errors', () => {
      const fp1 = generateNetworkErrorFingerprint('https://example.com/api', 'ECONNREFUSED');
      const fp2 = generateNetworkErrorFingerprint('https://example.com/api', 'ECONNREFUSED');
      expect(fp1).toBe(fp2);
    });

    it('should normalize error messages', () => {
      const fp1 = generateNetworkErrorFingerprint(
        'https://example.com/api',
        'Error at 2025-01-01T10:00:00Z: ECONNREFUSED'
      );
      const fp2 = generateNetworkErrorFingerprint(
        'https://example.com/api',
        'Error at 2025-12-31T23:59:59Z: ECONNREFUSED'
      );
      expect(fp1).toBe(fp2);
    });
  });

  describe('generateHttpErrorFingerprint', () => {
    it('should generate consistent fingerprint for same HTTP errors', () => {
      const fp1 = generateHttpErrorFingerprint('https://example.com/api', 500);
      const fp2 = generateHttpErrorFingerprint('https://example.com/api', 500);
      expect(fp1).toBe(fp2);
    });

    it('should differ for different status codes', () => {
      const fp500 = generateHttpErrorFingerprint('https://example.com/api', 500);
      const fp502 = generateHttpErrorFingerprint('https://example.com/api', 502);
      expect(fp500).not.toBe(fp502);
    });
  });

  describe('generateLatencyFingerprint', () => {
    it('should bucket latencies to nearest 100ms', () => {
      const fp1 = generateLatencyFingerprint('https://example.com/api', 1523);
      const fp2 = generateLatencyFingerprint('https://example.com/api', 1587);
      expect(fp1).toBe(fp2); // Both round to 1500ms
    });

    it('should differ for different latency buckets', () => {
      const fp1 = generateLatencyFingerprint('https://example.com/api', 1499);
      const fp2 = generateLatencyFingerprint('https://example.com/api', 1501);
      expect(fp1).not.toBe(fp2); // 1400ms vs 1500ms buckets
    });
  });
});
