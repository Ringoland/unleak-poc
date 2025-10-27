import {
  normalizeError,
  extractHost,
  normalizePath,
  generateFingerprint,
  getFingerprintSummary,
} from '../src/utils/fingerprint';

describe('Fingerprint Utility (Day 7)', () => {
  describe('normalizeError', () => {
    it('should remove UUIDs', () => {
      const error = 'Request a1b2c3d4-e5f6-4789-a012-123456789abc failed';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Request <UUID> failed');
    });

    it('should remove multiple UUIDs', () => {
      const error = 'Request 550e8400-e29b-41d4-a716-446655440000 to 6ba7b810-9dad-11d1-80b4-00c04fd430c8 failed';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Request <UUID> to <UUID> failed');
    });

    it('should remove ISO 8601 timestamps', () => {
      const error = 'Error at 2025-01-01T10:00:00.123Z occurred';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Error at <TIMESTAMP> occurred');
    });

    it('should remove Unix timestamps', () => {
      const error = 'Timestamp: 1704110400 or 1704110400000';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Timestamp: <TIMESTAMP> or <TIMESTAMP>');
    });

    it('should remove request IDs', () => {
      const error = 'Request req_abc123456 failed';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Request <REQUEST_ID> failed');
    });

    it('should remove trace IDs', () => {
      const error = 'Trace trace-abc123456789 error';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Trace <REQUEST_ID> error');
    });

    it('should remove hex tokens', () => {
      const error = 'Token: 1a2b3c4d5e6f7890abcdef1234567890';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Token: <HEX_TOKEN>');
    });

    it('should remove session IDs', () => {
      const error = 'Session sess_abc123456 expired';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Session <SESSION_ID> expired');
    });

    it('should remove IP addresses', () => {
      const error = 'Connection from 192.168.1.100 failed';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Connection from <IP> failed');
    });

    it('should remove numbers in brackets', () => {
      const error = 'Error [12345] occurred';
      const normalized = normalizeError(error);
      expect(normalized).toBe('Error [N] occurred');
    });

    it('should remove large standalone numbers but keep HTTP status codes', () => {
      const error = 'HTTP 500 error with request ID 123456789';
      const normalized = normalizeError(error);
      expect(normalized).toBe('HTTP 500 error with request ID <NUM>');
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

    it('should create consistent fingerprints for similar errors', () => {
      const error1 = 'Request req_12345 failed at 2025-01-01T10:00:00Z';
      const error2 = 'Request req_67890 failed at 2025-01-02T15:30:00Z';
      
      const norm1 = normalizeError(error1);
      const norm2 = normalizeError(error2);
      
      expect(norm1).toBe(norm2);
      expect(norm1).toBe('Request <REQUEST_ID> failed at <TIMESTAMP>');
    });
  });

  describe('extractHost', () => {
    it('should extract hostname from URL', () => {
      const url = 'https://example.com/path/to/resource';
      const host = extractHost(url);
      expect(host).toBe('example.com');
    });

    it('should extract hostname with subdomain', () => {
      const url = 'https://api.example.com/v1/users';
      const host = extractHost(url);
      expect(host).toBe('api.example.com');
    });

    it('should handle URLs with port', () => {
      const url = 'http://localhost:3000/api';
      const host = extractHost(url);
      expect(host).toBe('localhost');
    });

    it('should return original string for invalid URLs', () => {
      const invalidUrl = 'not-a-url';
      const host = extractHost(invalidUrl);
      expect(host).toBe(invalidUrl);
    });
  });

  describe('normalizePath', () => {
    it('should remove UUIDs from path', () => {
      const url = 'https://example.com/users/550e8400-e29b-41d4-a716-446655440000/profile';
      const normalized = normalizePath(url);
      expect(normalized).toBe('/users/<UUID>/profile');
    });

    it('should remove numeric IDs from path', () => {
      const url = 'https://example.com/posts/12345/comments';
      const normalized = normalizePath(url);
      expect(normalized).toBe('/posts/<ID>/comments');
    });

    it('should remove hex tokens from path', () => {
      const url = 'https://example.com/session/1a2b3c4d5e6f7890/data';
      const normalized = normalizePath(url);
      expect(normalized).toBe('/session/<TOKEN>/data');
    });

    it('should handle multiple dynamic segments', () => {
      const url = 'https://example.com/org/123/users/456/posts/789';
      const normalized = normalizePath(url);
      expect(normalized).toBe('/org/<ID>/users/<ID>/posts/<ID>');
    });

    it('should keep short numbers (like version numbers)', () => {
      const url = 'https://example.com/v1/api';
      const normalized = normalizePath(url);
      expect(normalized).toBe('/v1/api');
    });

    it('should return original for invalid URLs', () => {
      const invalidUrl = 'not-a-url';
      const normalized = normalizePath(invalidUrl);
      expect(normalized).toBe(invalidUrl);
    });
  });

  describe('generateFingerprint', () => {
    it('should generate consistent fingerprints for same error', () => {
      const input = {
        url: 'https://example.com/api/users',
        error: 'Connection timeout',
        method: 'GET',
      };

      const fp1 = generateFingerprint(input);
      const fp2 = generateFingerprint(input);

      expect(fp1).toBe(fp2);
      expect(fp1).toHaveLength(32); // SHA-256 truncated to 32 chars
    });

    it('should generate same fingerprint for errors with different IDs', () => {
      const input1 = {
        url: 'https://example.com/users/123/profile',
        error: 'Request req_abc123 failed at 2025-01-01T10:00:00Z',
        method: 'GET',
      };

      const input2 = {
        url: 'https://example.com/users/456/profile',
        error: 'Request req_xyz789 failed at 2025-01-02T15:30:00Z',
        method: 'GET',
      };

      const fp1 = generateFingerprint(input1);
      const fp2 = generateFingerprint(input2);

      expect(fp1).toBe(fp2);
    });

    it('should generate different fingerprints for different hosts', () => {
      const input1 = {
        url: 'https://example.com/api',
        error: 'Error occurred',
        method: 'GET',
      };

      const input2 = {
        url: 'https://different.com/api',
        error: 'Error occurred',
        method: 'GET',
      };

      const fp1 = generateFingerprint(input1);
      const fp2 = generateFingerprint(input2);

      expect(fp1).not.toBe(fp2);
    });

    it('should generate different fingerprints for different errors', () => {
      const input1 = {
        url: 'https://example.com/api',
        error: 'Connection timeout',
        method: 'GET',
      };

      const input2 = {
        url: 'https://example.com/api',
        error: 'Internal server error',
        method: 'GET',
      };

      const fp1 = generateFingerprint(input1);
      const fp2 = generateFingerprint(input2);

      expect(fp1).not.toBe(fp2);
    });

    it('should generate different fingerprints for different methods', () => {
      const input1 = {
        url: 'https://example.com/api',
        error: 'Error occurred',
        method: 'GET',
      };

      const input2 = {
        url: 'https://example.com/api',
        error: 'Error occurred',
        method: 'POST',
      };

      const fp1 = generateFingerprint(input1);
      const fp2 = generateFingerprint(input2);

      expect(fp1).not.toBe(fp2);
    });

    it('should default method to GET', () => {
      const inputWithMethod = {
        url: 'https://example.com/api',
        error: 'Error occurred',
        method: 'GET',
      };

      const inputWithoutMethod = {
        url: 'https://example.com/api',
        error: 'Error occurred',
      };

      const fp1 = generateFingerprint(inputWithMethod);
      const fp2 = generateFingerprint(inputWithoutMethod);

      expect(fp1).toBe(fp2);
    });

    it('should include status code for 5xx errors', () => {
      const input500 = {
        url: 'https://example.com/api',
        error: 'Server error',
        method: 'GET',
        statusCode: 500,
      };

      const input503 = {
        url: 'https://example.com/api',
        error: 'Server error',
        method: 'GET',
        statusCode: 503,
      };

      const fp500 = generateFingerprint(input500);
      const fp503 = generateFingerprint(input503);

      // Different 5xx status codes should create different fingerprints
      expect(fp500).not.toBe(fp503);
    });

    it('should not differentiate 4xx errors by status code', () => {
      const input400 = {
        url: 'https://example.com/api',
        error: 'Client error',
        method: 'GET',
        statusCode: 400,
      };

      const input404 = {
        url: 'https://example.com/api',
        error: 'Client error',
        method: 'GET',
        statusCode: 404,
      };

      const fp400 = generateFingerprint(input400);
      const fp404 = generateFingerprint(input404);

      // Same error message with different 4xx codes should match
      expect(fp400).toBe(fp404);
    });
  });

  describe('getFingerprintSummary', () => {
    it('should return all fingerprint components', () => {
      const input = {
        url: 'https://api.example.com/users/123/posts/456',
        error: 'Request req_abc123 failed at 2025-01-01T10:00:00Z',
        method: 'POST',
      };

      const summary = getFingerprintSummary(input);

      expect(summary.host).toBe('api.example.com');
      expect(summary.path).toBe('/users/<ID>/posts/<ID>');
      expect(summary.normalizedError).toBe('Request <REQUEST_ID> failed at <TIMESTAMP>');
      expect(summary.method).toBe('POST');
      expect(summary.fingerprint).toHaveLength(32);
    });

    it('should match fingerprint from generateFingerprint', () => {
      const input = {
        url: 'https://example.com/api',
        error: 'Connection timeout',
        method: 'GET',
      };

      const summary = getFingerprintSummary(input);
      const directFingerprint = generateFingerprint(input);

      expect(summary.fingerprint).toBe(directFingerprint);
    });
  });
});
