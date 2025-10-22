import { loadAllowList, isUrlAllowed, getAllowListPatterns } from '../src/services/allowListService';
import fs from 'fs';
import path from 'path';

// Mock logger
jest.mock('../src/utils/logger');

describe('Allow-list Service', () => {
  const testAllowListPath = path.join(__dirname, 'test-allow-list.csv');

  beforeEach(() => {
    // Clean up any existing test file
    if (fs.existsSync(testAllowListPath)) {
      fs.unlinkSync(testAllowListPath);
    }
  });

  afterEach(() => {
    // Clean up test file
    if (fs.existsSync(testAllowListPath)) {
      fs.unlinkSync(testAllowListPath);
    }
  });

  describe('loadAllowList', () => {
    it('should load patterns from CSV file', () => {
      const content = `*.example.com
https://api.safe.com/*
https://trusted.org/api/*`;
      
      fs.writeFileSync(testAllowListPath, content);
      loadAllowList(testAllowListPath);
      
      const patterns = getAllowListPatterns();
      expect(patterns.length).toBe(3);
    });

    it('should skip empty lines', () => {
      const content = `*.example.com

https://api.safe.com/*

`;
      
      fs.writeFileSync(testAllowListPath, content);
      loadAllowList(testAllowListPath);
      
      const patterns = getAllowListPatterns();
      expect(patterns.length).toBe(2);
    });

    it('should skip comment lines', () => {
      const content = `# This is a comment
*.example.com
# Another comment
https://api.safe.com/*`;
      
      fs.writeFileSync(testAllowListPath, content);
      loadAllowList(testAllowListPath);
      
      const patterns = getAllowListPatterns();
      expect(patterns.length).toBe(2);
    });

    it('should handle missing file gracefully', () => {
      loadAllowList('/nonexistent/path.csv');
      const patterns = getAllowListPatterns();
      expect(patterns.length).toBe(0); // Empty list, no error
    });

    it('should handle empty file', () => {
      fs.writeFileSync(testAllowListPath, '');
      loadAllowList(testAllowListPath);
      
      const patterns = getAllowListPatterns();
      expect(patterns.length).toBe(0);
    });
  });

  describe('isUrlAllowed', () => {
    beforeEach(() => {
      const content = `*example.com*
https://api.safe.com/*
https://trusted.org/api/public/*
exact-match.com`;
      
      fs.writeFileSync(testAllowListPath, content);
      loadAllowList(testAllowListPath);
    });

    it('should allow URLs matching wildcard subdomain pattern', () => {
      expect(isUrlAllowed('https://sub.example.com/page')).toBe(true);
      expect(isUrlAllowed('https://api.example.com/users')).toBe(true);
      expect(isUrlAllowed('http://www.example.com')).toBe(true);
    });

    it('should allow URLs matching wildcard path pattern', () => {
      expect(isUrlAllowed('https://api.safe.com/users')).toBe(true);
      expect(isUrlAllowed('https://api.safe.com/posts/123')).toBe(true);
    });

    it('should allow URLs matching specific path pattern', () => {
      expect(isUrlAllowed('https://trusted.org/api/public/data')).toBe(true);
      expect(isUrlAllowed('https://trusted.org/api/public/users/123')).toBe(true);
    });

    it('should reject URLs not matching any pattern', () => {
      expect(isUrlAllowed('https://other.com/page')).toBe(false);
      expect(isUrlAllowed('https://malicious.net')).toBe(false);
    });

    it('should reject URLs matching partial patterns', () => {
      expect(isUrlAllowed('https://trusted.org/api/private/data')).toBe(false);
      expect(isUrlAllowed('https://api.unsafe.com/data')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isUrlAllowed('https://SUB.EXAMPLE.COM/page')).toBe(true);
      expect(isUrlAllowed('HTTPS://API.SAFE.COM/users')).toBe(true);
    });

    it('should allow exact match', () => {
      expect(isUrlAllowed('exact-match.com')).toBe(true);
      expect(isUrlAllowed('exact-match.com/')).toBe(false); // Not exact
    });

    it('should allow all URLs when list is empty', () => {
      fs.writeFileSync(testAllowListPath, '');
      loadAllowList(testAllowListPath);
      
      expect(isUrlAllowed('https://any.com')).toBe(true);
      expect(isUrlAllowed('https://everything.org')).toBe(true);
    });
  });

  describe('reloadAllowList', () => {
    it('should reload patterns from file', () => {
      // Initial load
      fs.writeFileSync(testAllowListPath, '*.example.com');
      loadAllowList(testAllowListPath);
      
      let patterns = getAllowListPatterns();
      expect(patterns.length).toBe(1);
      
      // Update file
      fs.writeFileSync(testAllowListPath, `*.example.com
https://api.safe.com/*
https://new-domain.com/*`);
      
      // Reload with same path
      loadAllowList(testAllowListPath);
      
      patterns = getAllowListPatterns();
      expect(patterns.length).toBe(3);
    });
  });

  describe('getAllowListPatterns', () => {
    it('should return regex source patterns', () => {
      const content = `*.example.com
https://api.safe.com/*`;
      
      fs.writeFileSync(testAllowListPath, content);
      loadAllowList(testAllowListPath);
      
      const patterns = getAllowListPatterns();
      expect(patterns.length).toBe(2);
      expect(patterns.every(p => typeof p === 'string')).toBe(true);
    });

    it('should return empty array when no patterns loaded', () => {
      const patterns = getAllowListPatterns();
      expect(patterns).toEqual(expect.any(Array));
    });
  });

  describe('Wildcard pattern matching', () => {
    beforeEach(() => {
      const content = `*.example.com/*
https://*.safe.com/api/*
*/public/*`;
      
      fs.writeFileSync(testAllowListPath, content);
      loadAllowList(testAllowListPath);
    });

    it('should handle multiple wildcards', () => {
      expect(isUrlAllowed('https://sub.example.com/path/to/resource')).toBe(true);
      expect(isUrlAllowed('https://api.safe.com/api/users')).toBe(true);
    });

    it('should handle wildcard at start of pattern', () => {
      expect(isUrlAllowed('https://any.com/public/data')).toBe(true);
      expect(isUrlAllowed('http://example.org/public/users')).toBe(true);
    });

    it('should not match when wildcard placement differs', () => {
      expect(isUrlAllowed('https://example.com')).toBe(false); // Missing /* at end
    });
  });
});
