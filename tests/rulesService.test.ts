import {
  loadRulesConfig,
  findMatchingRule,
  getEffectiveCooldown,
  getEffectiveLatencyThreshold,
  getEffectiveRobotsRespect,
  isInMaintenanceWindow,
  shouldSuppressDuringMaintenance,
} from '../src/services/rulesService';
import fs from 'fs';
import path from 'path';

// Mock logger
jest.mock('../src/utils/logger');

describe('Rules Service', () => {
  const testConfigPath = path.join(__dirname, 'test-rules.json');

  const validConfig = {
    defaults: {
      cooldownSeconds: 900,
      latencyMsThreshold: 1500,
      respectRobots: true,
      suppressDuringMaintenance: true,
    },
    rules: [
      {
        id: 'api-endpoints',
        pattern: 'https://api\\.example\\.com/.*',
        cooldownSeconds: 600,
        latencyMsThreshold: 1000,
        respectRobots: false,
      },
      {
        id: 'default-web',
        pattern: '.*',
        maintenance: [
          {
            start: '2025-01-01T02:00:00Z',
            end: '2025-01-01T03:00:00Z',
            description: 'Test maintenance',
          },
        ],
        suppressDuringMaintenance: true,
      },
    ],
  };

  beforeEach(() => {
    // Clean up any existing test config
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  afterEach(() => {
    // Clean up test config
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  describe('loadRulesConfig', () => {
    it('should load valid configuration', () => {
      fs.writeFileSync(testConfigPath, JSON.stringify(validConfig));
      const config = loadRulesConfig(testConfigPath);
      expect(config.defaults.cooldownSeconds).toBe(900);
      expect(config.rules.length).toBe(2);
    });

    it('should throw error for missing file', () => {
      expect(() => {
        loadRulesConfig('/nonexistent/path.json');
      }).toThrow();
    });

    it('should throw error for invalid JSON', () => {
      fs.writeFileSync(testConfigPath, 'invalid json {');
      expect(() => {
        loadRulesConfig(testConfigPath);
      }).toThrow();
    });

    it('should throw error for missing defaults', () => {
      const invalidConfig = { rules: [] };
      fs.writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      expect(() => {
        loadRulesConfig(testConfigPath);
      }).toThrow('must have a "defaults" object');
    });

    it('should throw error for negative cooldown', () => {
      const invalidConfig = {
        ...validConfig,
        defaults: { ...validConfig.defaults, cooldownSeconds: -100 },
      };
      fs.writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      expect(() => {
        loadRulesConfig(testConfigPath);
      }).toThrow('must be a non-negative number');
    });

    it('should throw error for invalid regex pattern', () => {
      const invalidConfig = {
        ...validConfig,
        rules: [{ id: 'test', pattern: '[invalid(' }],
      };
      fs.writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      expect(() => {
        loadRulesConfig(testConfigPath);
      }).toThrow('invalid regex pattern');
    });

    it('should throw error for invalid maintenance window', () => {
      const invalidConfig = {
        ...validConfig,
        rules: [
          {
            id: 'test',
            pattern: '.*',
            maintenance: [
              {
                start: '2025-01-01T03:00:00Z',
                end: '2025-01-01T02:00:00Z', // End before start
              },
            ],
          },
        ],
      };
      fs.writeFileSync(testConfigPath, JSON.stringify(invalidConfig));
      expect(() => {
        loadRulesConfig(testConfigPath);
      }).toThrow('"start" must be before "end"');
    });
  });

  describe('findMatchingRule', () => {
    beforeEach(() => {
      fs.writeFileSync(testConfigPath, JSON.stringify(validConfig));
      loadRulesConfig(testConfigPath);
    });

    it('should find specific rule by pattern', () => {
      const rule = findMatchingRule('https://api.example.com/users');
      expect(rule?.id).toBe('api-endpoints');
    });

    it('should find fallback rule', () => {
      const rule = findMatchingRule('https://other.com/page');
      expect(rule?.id).toBe('default-web');
    });

    it('should return null if no rules match', () => {
      const emptyConfig = { defaults: validConfig.defaults, rules: [] };
      fs.writeFileSync(testConfigPath, JSON.stringify(emptyConfig));
      loadRulesConfig(testConfigPath);
      
      const rule = findMatchingRule('https://example.com');
      expect(rule).toBeNull();
    });

    it('should return first matching rule', () => {
      const rule = findMatchingRule('https://example.com/test');
      expect(rule?.id).toBe('default-web'); // Matches .* pattern
    });
  });

  describe('getEffectiveCooldown', () => {
    beforeEach(() => {
      fs.writeFileSync(testConfigPath, JSON.stringify(validConfig));
      loadRulesConfig(testConfigPath);
    });

    it('should return rule-specific cooldown', () => {
      const rule = findMatchingRule('https://api.example.com/users');
      const cooldown = getEffectiveCooldown(rule);
      expect(cooldown).toBe(600);
    });

    it('should return default cooldown when rule has none', () => {
      const rule = findMatchingRule('https://other.com');
      const cooldown = getEffectiveCooldown(rule);
      expect(cooldown).toBe(900);
    });

    it('should return default cooldown when no rule matches', () => {
      const cooldown = getEffectiveCooldown(null);
      expect(cooldown).toBe(900);
    });
  });

  describe('getEffectiveLatencyThreshold', () => {
    beforeEach(() => {
      fs.writeFileSync(testConfigPath, JSON.stringify(validConfig));
      loadRulesConfig(testConfigPath);
    });

    it('should return rule-specific threshold', () => {
      const rule = findMatchingRule('https://api.example.com/users');
      const threshold = getEffectiveLatencyThreshold(rule);
      expect(threshold).toBe(1000);
    });

    it('should return default threshold when rule has none', () => {
      const rule = findMatchingRule('https://other.com');
      const threshold = getEffectiveLatencyThreshold(rule);
      expect(threshold).toBe(1500);
    });
  });

  describe('getEffectiveRobotsRespect', () => {
    beforeEach(() => {
      fs.writeFileSync(testConfigPath, JSON.stringify(validConfig));
      loadRulesConfig(testConfigPath);
    });

    it('should return rule-specific robots respect setting', () => {
      const rule = findMatchingRule('https://api.example.com/users');
      const respect = getEffectiveRobotsRespect(rule);
      expect(respect).toBe(false);
    });

    it('should return default robots respect when rule has none', () => {
      const rule = findMatchingRule('https://other.com');
      const respect = getEffectiveRobotsRespect(rule);
      expect(respect).toBe(true);
    });
  });

  describe('isInMaintenanceWindow', () => {
    beforeEach(() => {
      fs.writeFileSync(testConfigPath, JSON.stringify(validConfig));
      loadRulesConfig(testConfigPath);
    });

    it('should return false when no maintenance windows defined', () => {
      const rule = findMatchingRule('https://api.example.com/users');
      const inWindow = isInMaintenanceWindow(rule);
      expect(inWindow).toBe(false);
    });

    it('should return false when not in maintenance window', () => {
      const rule = findMatchingRule('https://other.com');
      const inWindow = isInMaintenanceWindow(rule);
      expect(inWindow).toBe(false); // 2025-01-01 window is in the past
    });

    it('should return false when rule is null', () => {
      const inWindow = isInMaintenanceWindow(null);
      expect(inWindow).toBe(false);
    });

    it('should return true when in active maintenance window', () => {
      const now = new Date();
      const futureConfig = {
        ...validConfig,
        rules: [
          {
            id: 'test',
            pattern: '.*',
            maintenance: [
              {
                start: new Date(now.getTime() - 3600000).toISOString(), // 1 hour ago
                end: new Date(now.getTime() + 3600000).toISOString(), // 1 hour from now
                description: 'Active maintenance',
              },
            ],
          },
        ],
      };
      
      fs.writeFileSync(testConfigPath, JSON.stringify(futureConfig));
      loadRulesConfig(testConfigPath);
      
      const rule = findMatchingRule('https://example.com');
      const inWindow = isInMaintenanceWindow(rule);
      expect(inWindow).toBe(true);
    });
  });

  describe('shouldSuppressDuringMaintenance', () => {
    it('should return false when rule is null', () => {
      const suppress = shouldSuppressDuringMaintenance(null);
      expect(suppress).toBe(false);
    });

    it('should return false when not in maintenance window', () => {
      fs.writeFileSync(testConfigPath, JSON.stringify(validConfig));
      loadRulesConfig(testConfigPath);
      
      const rule = findMatchingRule('https://other.com');
      const suppress = shouldSuppressDuringMaintenance(rule);
      expect(suppress).toBe(false);
    });

    it('should respect suppressDuringMaintenance setting', () => {
      const now = new Date();
      const testConfig = {
        ...validConfig,
        rules: [
          {
            id: 'no-suppress',
            pattern: '.*',
            maintenance: [
              {
                start: new Date(now.getTime() - 3600000).toISOString(),
                end: new Date(now.getTime() + 3600000).toISOString(),
              },
            ],
            suppressDuringMaintenance: false, // Don't suppress
          },
        ],
      };
      
      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig));
      loadRulesConfig(testConfigPath);
      
      const rule = findMatchingRule('https://example.com');
      const suppress = shouldSuppressDuringMaintenance(rule);
      expect(suppress).toBe(false); // Even though in window, suppression is disabled
    });
  });
});
