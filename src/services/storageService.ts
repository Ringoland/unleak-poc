import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';

export type ArtifactType = 'screenshot' | 'har' | 'html' | 'console_logs';

export interface StorageResult {
  storageUrl: string;
  size: number;
}

export class StorageService {
  private readonly baseDir: string;

  constructor(baseDir: string = './artifacts') {
    this.baseDir = baseDir;
  }

  /**
   * Initialize storage directories
   */
  async initialize(): Promise<void> {
    const dirs = ['screenshots', 'har', 'html', 'logs'];

    for (const dir of dirs) {
      const fullPath = path.join(this.baseDir, dir);
      await fs.mkdir(fullPath, { recursive: true });
    }

    logger.info(`Storage service initialized at ${this.baseDir}`);
  }

  /**
   * Save a screenshot
   */
  async saveScreenshot(findingId: string, buffer: Buffer): Promise<StorageResult> {
    const filename = `${findingId}_${Date.now()}.png`;
    const relativePath = path.join('screenshots', filename);
    const fullPath = path.join(this.baseDir, relativePath);

    await fs.writeFile(fullPath, buffer);
    const stats = await fs.stat(fullPath);

    logger.info(`Screenshot saved: ${relativePath} (${stats.size} bytes)`);

    return {
      storageUrl: relativePath,
      size: stats.size,
    };
  }

  /**
   * Save HAR file (HTTP Archive)
   */
  async saveHAR(findingId: string, harData: any): Promise<StorageResult> {
    const filename = `${findingId}_${Date.now()}.har`;
    const relativePath = path.join('har', filename);
    const fullPath = path.join(this.baseDir, relativePath);

    const harJson = JSON.stringify(harData, null, 2);
    await fs.writeFile(fullPath, harJson, 'utf-8');
    const stats = await fs.stat(fullPath);

    logger.info(`HAR file saved: ${relativePath} (${stats.size} bytes)`);

    return {
      storageUrl: relativePath,
      size: stats.size,
    };
  }

  /**
   * Save HTML source (with optional compression)
   */
  async saveHTML(findingId: string, html: string): Promise<StorageResult> {
    const filename = `${findingId}_${Date.now()}.html`;
    const relativePath = path.join('html', filename);
    const fullPath = path.join(this.baseDir, relativePath);

    await fs.writeFile(fullPath, html, 'utf-8');
    const stats = await fs.stat(fullPath);

    logger.info(`HTML saved: ${relativePath} (${stats.size} bytes)`);

    return {
      storageUrl: relativePath,
      size: stats.size,
    };
  }

  /**
   * Save console logs
   */
  async saveConsoleLogs(findingId: string, logs: any[]): Promise<StorageResult> {
    const filename = `${findingId}_${Date.now()}.json`;
    const relativePath = path.join('logs', filename);
    const fullPath = path.join(this.baseDir, relativePath);

    const logsJson = JSON.stringify(logs, null, 2);
    await fs.writeFile(fullPath, logsJson, 'utf-8');
    const stats = await fs.stat(fullPath);

    logger.info(`Console logs saved: ${relativePath} (${stats.size} bytes)`);

    return {
      storageUrl: relativePath,
      size: stats.size,
    };
  }

  /**
   * Read an artifact file
   */
  async readArtifact(storageUrl: string): Promise<Buffer> {
    const fullPath = path.join(this.baseDir, storageUrl);
    return await fs.readFile(fullPath);
  }

  /**
   * Delete an artifact file
   */
  async deleteArtifact(storageUrl: string): Promise<void> {
    const fullPath = path.join(this.baseDir, storageUrl);
    await fs.unlink(fullPath);
    logger.info(`Artifact deleted: ${storageUrl}`);
  }

  /**
   * Clean up expired artifacts
   */
  async cleanupExpiredArtifacts(expirationDate: Date): Promise<number> {
    let deletedCount = 0;
    const dirs = ['screenshots', 'har', 'html', 'logs'];

    for (const dir of dirs) {
      const fullPath = path.join(this.baseDir, dir);
      const files = await fs.readdir(fullPath);

      for (const file of files) {
        const filePath = path.join(fullPath, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime < expirationDate) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      }
    }

    if (deletedCount > 0) {
      logger.info(`Cleaned up ${deletedCount} expired artifacts`);
    }

    return deletedCount;
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    byType: Record<string, { count: number; size: number }>;
  }> {
    const stats = {
      totalFiles: 0,
      totalSize: 0,
      byType: {} as Record<string, { count: number; size: number }>,
    };

    const dirs = ['screenshots', 'har', 'html', 'logs'];

    for (const dir of dirs) {
      const fullPath = path.join(this.baseDir, dir);

      try {
        const files = await fs.readdir(fullPath);
        let dirSize = 0;

        for (const file of files) {
          const filePath = path.join(fullPath, file);
          const fileStat = await fs.stat(filePath);
          dirSize += fileStat.size;
        }

        stats.byType[dir] = {
          count: files.length,
          size: dirSize,
        };

        stats.totalFiles += files.length;
        stats.totalSize += dirSize;
      } catch (error) {
        logger.warn(`Could not read directory ${dir}:`, error);
      }
    }

    return stats;
  }
}

// Singleton instance
export const storageService = new StorageService();
