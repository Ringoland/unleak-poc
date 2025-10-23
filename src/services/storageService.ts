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
  async initialize(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    logger.info(`Storage service initialized at ${this.baseDir}`);
  }

  /**
   * Get the directory path for a specific finding
   * Structure: artifacts/<runId>/<findingId>/
   */
  private getFindingDir(runId: string, findingId: string): string {
    return path.join(this.baseDir, runId, findingId);
  }

  /**
   * Ensure the directory exists for a finding
   */
  private async ensureFindingDir(runId: string, findingId: string): Promise<string> {
    const dir = this.getFindingDir(runId, findingId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Save a screenshot
   * New structure: artifacts/<runId>/<findingId>/screenshot.png
   */
  async saveScreenshot(runId: string, findingId: string, buffer: Buffer): Promise<StorageResult> {
    const dir = await this.ensureFindingDir(runId, findingId);
    const filename = 'screenshot.png';
    const fullPath = path.join(dir, filename);
    const relativePath = path.join(runId, findingId, filename);

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
   * New structure: artifacts/<runId>/<findingId>/trace.har
   */
  async saveHAR(runId: string, findingId: string, harData: any): Promise<StorageResult> {
    const dir = await this.ensureFindingDir(runId, findingId);
    const filename = 'trace.har';
    const fullPath = path.join(dir, filename);
    const relativePath = path.join(runId, findingId, filename);

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
   * Save HTML source
   * New structure: artifacts/<runId>/<findingId>/page.html
   */
  async saveHTML(runId: string, findingId: string, html: string): Promise<StorageResult> {
    const dir = await this.ensureFindingDir(runId, findingId);
    const filename = 'page.html';
    const fullPath = path.join(dir, filename);
    const relativePath = path.join(runId, findingId, filename);

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
   * New structure: artifacts/<runId>/<findingId>/console.json
   */
  async saveConsoleLogs(runId: string, findingId: string, logs: any[]): Promise<StorageResult> {
    const dir = await this.ensureFindingDir(runId, findingId);
    const filename = 'console.json';
    const fullPath = path.join(dir, filename);
    const relativePath = path.join(runId, findingId, filename);

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
