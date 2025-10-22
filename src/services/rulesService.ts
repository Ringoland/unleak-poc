import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface MaintenanceWindow {
  start: string; // ISO 8601 timestamp
  end: string; // ISO 8601 timestamp
  description?: string;
  timezone?: string; // Optional timezone (defaults to UTC)
}

export interface Rule {
  id: string;
  pattern: string; // Regex pattern to match URLs
  cooldownSeconds?: number;
  latencyMsThreshold?: number;
  respectRobots?: boolean;
  maintenance?: MaintenanceWindow[];
  suppressDuringMaintenance?: boolean;
}

export interface RulesDefaults {
  cooldownSeconds: number;
  latencyMsThreshold: number;
  respectRobots: boolean;
  suppressDuringMaintenance?: boolean;
}

export interface RulesConfig {
  defaults: RulesDefaults;
  rules: Rule[];
}

let rulesConfigCache: RulesConfig | null = null;

/**
 * Validate rules configuration schema
 */
function validateRulesConfig(config: any): config is RulesConfig {
  // Check top-level structure
  if (!config || typeof config !== 'object') {
    throw new Error('Rules config must be an object');
  }

  // Validate defaults
  if (!config.defaults || typeof config.defaults !== 'object') {
    throw new Error('Rules config must have a "defaults" object');
  }

  const { defaults } = config;
  if (typeof defaults.cooldownSeconds !== 'number' || defaults.cooldownSeconds < 0) {
    throw new Error('defaults.cooldownSeconds must be a non-negative number');
  }
  if (typeof defaults.latencyMsThreshold !== 'number' || defaults.latencyMsThreshold < 0) {
    throw new Error('defaults.latencyMsThreshold must be a non-negative number');
  }
  if (typeof defaults.respectRobots !== 'boolean') {
    throw new Error('defaults.respectRobots must be a boolean');
  }

  // Validate rules array
  if (!Array.isArray(config.rules)) {
    throw new Error('Rules config must have a "rules" array');
  }

  // Validate each rule
  config.rules.forEach((rule: any, index: number) => {
    if (!rule.id || typeof rule.id !== 'string') {
      throw new Error(`Rule at index ${index} must have a string "id"`);
    }
    if (!rule.pattern || typeof rule.pattern !== 'string') {
      throw new Error(`Rule "${rule.id}" must have a string "pattern"`);
    }

    // Test if pattern is valid regex
    try {
      new RegExp(rule.pattern);
    } catch (e) {
      throw new Error(`Rule "${rule.id}" has invalid regex pattern: ${rule.pattern}`);
    }

    // Validate optional fields
    if (rule.cooldownSeconds !== undefined) {
      if (typeof rule.cooldownSeconds !== 'number' || rule.cooldownSeconds < 0) {
        throw new Error(`Rule "${rule.id}" cooldownSeconds must be a non-negative number`);
      }
    }

    if (rule.latencyMsThreshold !== undefined) {
      if (typeof rule.latencyMsThreshold !== 'number' || rule.latencyMsThreshold < 0) {
        throw new Error(`Rule "${rule.id}" latencyMsThreshold must be a non-negative number`);
      }
    }

    if (rule.respectRobots !== undefined && typeof rule.respectRobots !== 'boolean') {
      throw new Error(`Rule "${rule.id}" respectRobots must be a boolean`);
    }

    // Validate maintenance windows
    if (rule.maintenance !== undefined) {
      if (!Array.isArray(rule.maintenance)) {
        throw new Error(`Rule "${rule.id}" maintenance must be an array`);
      }

      rule.maintenance.forEach((window: any, winIndex: number) => {
        if (!window.start || typeof window.start !== 'string') {
          throw new Error(
            `Rule "${rule.id}" maintenance window ${winIndex} must have a string "start"`
          );
        }
        if (!window.end || typeof window.end !== 'string') {
          throw new Error(
            `Rule "${rule.id}" maintenance window ${winIndex} must have a string "end"`
          );
        }

        // Validate ISO 8601 timestamps
        const startDate = new Date(window.start);
        const endDate = new Date(window.end);
        if (isNaN(startDate.getTime())) {
          throw new Error(
            `Rule "${rule.id}" maintenance window ${winIndex} has invalid "start" timestamp`
          );
        }
        if (isNaN(endDate.getTime())) {
          throw new Error(
            `Rule "${rule.id}" maintenance window ${winIndex} has invalid "end" timestamp`
          );
        }
        if (startDate >= endDate) {
          throw new Error(
            `Rule "${rule.id}" maintenance window ${winIndex} "start" must be before "end"`
          );
        }
      });
    }
  });

  return true;
}

/**
 * Load and validate rules configuration from file
 */
export function loadRulesConfig(filePath?: string): RulesConfig {
  const configPath =
    filePath || process.env.RULES_FILE || path.join(process.cwd(), 'src', 'config', 'rules.json');

  try {
    logger.info(`[Rules] Loading rules configuration from: ${configPath}`);

    if (!fs.existsSync(configPath)) {
      throw new Error(`Rules configuration file not found: ${configPath}`);
    }

    const fileContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(fileContent);

    // Validate schema
    validateRulesConfig(config);

    logger.info(`[Rules] Configuration loaded successfully with ${config.rules.length} rule(s)`);

    // Cache the config
    rulesConfigCache = config;

    return config;
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Unknown error loading rules configuration';
    logger.error(`[Rules] Failed to load configuration: ${errorMessage}`);
    throw new Error(`Invalid rules configuration: ${errorMessage}`);
  }
}

/**
 * Get cached rules configuration
 */
export function getRulesConfig(): RulesConfig {
  if (!rulesConfigCache) {
    throw new Error('Rules configuration not loaded. Call loadRulesConfig() first.');
  }
  return rulesConfigCache;
}

/**
 * Find matching rule for a URL
 */
export function findMatchingRule(url: string): Rule | null {
  const config = getRulesConfig();

  // Find first matching rule
  for (const rule of config.rules) {
    const regex = new RegExp(rule.pattern);
    if (regex.test(url)) {
      return rule;
    }
  }

  return null;
}

/**
 * Get effective cooldown for a rule (rule-specific or default)
 */
export function getEffectiveCooldown(rule: Rule | null): number {
  const config = getRulesConfig();
  if (rule && rule.cooldownSeconds !== undefined) {
    return rule.cooldownSeconds;
  }
  return config.defaults.cooldownSeconds;
}

/**
 * Get effective latency threshold for a rule (rule-specific or default)
 */
export function getEffectiveLatencyThreshold(rule: Rule | null): number {
  const config = getRulesConfig();
  if (rule && rule.latencyMsThreshold !== undefined) {
    return rule.latencyMsThreshold;
  }
  return config.defaults.latencyMsThreshold;
}

/**
 * Get effective robots.txt respect setting for a rule
 */
export function getEffectiveRobotsRespect(rule: Rule | null): boolean {
  const config = getRulesConfig();
  if (rule && rule.respectRobots !== undefined) {
    return rule.respectRobots;
  }
  return config.defaults.respectRobots;
}

/**
 * Check if current time is within any maintenance window
 */
export function isInMaintenanceWindow(rule: Rule | null): boolean {
  if (!rule || !rule.maintenance || rule.maintenance.length === 0) {
    return false;
  }

  const now = new Date();

  for (const window of rule.maintenance) {
    const start = new Date(window.start);
    const end = new Date(window.end);

    if (now >= start && now <= end) {
      logger.debug(`[Rules] Current time is within maintenance window: ${window.description || 'unnamed'}`);
      return true;
    }
  }

  return false;
}

/**
 * Check if alerts should be suppressed during maintenance
 */
export function shouldSuppressDuringMaintenance(rule: Rule | null): boolean {
  if (!rule) {
    return false;
  }

  const suppressFlag = rule.suppressDuringMaintenance ?? getRulesConfig().defaults.suppressDuringMaintenance ?? true;
  return isInMaintenanceWindow(rule) && suppressFlag;
}
