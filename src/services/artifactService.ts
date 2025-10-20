import { db } from '../db';
import { artifacts, type NewArtifact, type Artifact } from '../db/schema/artifacts';
import { eq, and, lt } from 'drizzle-orm';
import { storageService, type StorageResult, type ArtifactType } from './storageService';
import { logger } from '../utils/logger';

export interface SaveArtifactInput {
  findingId: string;
  type: ArtifactType;
  data: Buffer | string | any;
}

export class ArtifactService {
  /**
   * Save an artifact to storage and record in database
   */
  async saveArtifact(input: SaveArtifactInput): Promise<Artifact> {
    const { findingId, type, data } = input;

    let storageResult: StorageResult;

    try {
      // Save to storage based on type
      switch (type) {
        case 'screenshot':
          if (!Buffer.isBuffer(data)) {
            throw new Error('Screenshot data must be a Buffer');
          }
          storageResult = await storageService.saveScreenshot(findingId, data);
          break;

        case 'har':
          storageResult = await storageService.saveHAR(findingId, data);
          break;

        case 'html':
          if (typeof data !== 'string') {
            throw new Error('HTML data must be a string');
          }
          storageResult = await storageService.saveHTML(findingId, data);
          break;

        case 'console_logs':
          if (!Array.isArray(data)) {
            throw new Error('Console logs data must be an array');
          }
          storageResult = await storageService.saveConsoleLogs(findingId, data);
          break;

        default:
          throw new Error(`Unsupported artifact type: ${type}`);
      }

      // Calculate expiration date (7 days from now)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Create database record
      const newArtifact: NewArtifact = {
        findingId,
        type,
        storageUrl: storageResult.storageUrl,
        size: storageResult.size,
        expiresAt,
      };

      const [artifact] = await db.insert(artifacts).values(newArtifact).returning();

      logger.info(`Artifact saved: ${type} for finding ${findingId} (${storageResult.size} bytes)`);

      return artifact;
    } catch (error) {
      logger.error(`Failed to save artifact ${type} for finding ${findingId}:`, error);
      throw error;
    }
  }

  /**
   * Save multiple artifacts at once
   */
  async saveArtifacts(inputs: SaveArtifactInput[]): Promise<Artifact[]> {
    const results: Artifact[] = [];

    for (const input of inputs) {
      const artifact = await this.saveArtifact(input);
      results.push(artifact);
    }

    return results;
  }

  /**
   * Get all artifacts for a finding
   */
  async getArtifactsByFindingId(findingId: string): Promise<Artifact[]> {
    return await db.select().from(artifacts).where(eq(artifacts.findingId, findingId));
  }

  /**
   * Get a specific artifact by ID
   */
  async getArtifactById(id: string): Promise<Artifact | null> {
    const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, id));
    return artifact || null;
  }

  /**
   * Get artifact content from storage
   */
  async getArtifactContent(artifact: Artifact): Promise<Buffer> {
    return await storageService.readArtifact(artifact.storageUrl);
  }

  /**
   * Delete an artifact (both database record and file)
   */
  async deleteArtifact(id: string): Promise<void> {
    const artifact = await this.getArtifactById(id);

    if (!artifact) {
      logger.warn(`Artifact ${id} not found, skipping deletion`);
      return;
    }

    try {
      // Delete file from storage
      await storageService.deleteArtifact(artifact.storageUrl);
    } catch (error) {
      logger.warn(`Failed to delete artifact file ${artifact.storageUrl}:`, error);
    }

    // Delete database record
    await db.delete(artifacts).where(eq(artifacts.id, id));
    logger.info(`Artifact ${id} deleted`);
  }

  /**
   * Clean up expired artifacts (both database and files)
   */
  async cleanupExpiredArtifacts(): Promise<{ deletedCount: number }> {
    const now = new Date();

    // Find expired artifacts
    const expiredArtifacts = await db
      .select()
      .from(artifacts)
      .where(and(lt(artifacts.expiresAt, now)));

    logger.info(`Found ${expiredArtifacts.length} expired artifacts to clean up`);

    let deletedCount = 0;

    for (const artifact of expiredArtifacts) {
      try {
        await this.deleteArtifact(artifact.id);
        deletedCount++;
      } catch (error) {
        logger.error(`Failed to delete expired artifact ${artifact.id}:`, error);
      }
    }

    logger.info(`Cleaned up ${deletedCount} expired artifacts`);

    return { deletedCount };
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    totalArtifacts: number;
    totalSize: number;
    byType: Record<string, { count: number; size: number }>;
  }> {
    const allArtifacts = await db.select().from(artifacts);

    const stats = {
      totalArtifacts: allArtifacts.length,
      totalSize: 0,
      byType: {} as Record<string, { count: number; size: number }>,
    };

    for (const artifact of allArtifacts) {
      stats.totalSize += artifact.size;

      if (!stats.byType[artifact.type]) {
        stats.byType[artifact.type] = { count: 0, size: 0 };
      }

      stats.byType[artifact.type].count++;
      stats.byType[artifact.type].size += artifact.size;
    }

    return stats;
  }
}

// Singleton instance
export const artifactService = new ArtifactService();
