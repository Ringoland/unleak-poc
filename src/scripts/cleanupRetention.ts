import { db } from '../db';
import { findings, artifacts } from '../db/schema';
import { lt } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { config } from '../config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Clean up findings and artifacts older than RETENTION_DAYS
 * This should be run as a daily cron job
 */
export async function cleanupRetention(): Promise<void> {
  const retentionDays = config.retentionDays;
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  logger.info(`[Retention] Starting cleanup for data older than ${retentionDays} days (before ${cutoffDate.toISOString()})`);

  try {
    // Step 1: Find old artifacts to get file paths
    const oldArtifacts = await db.query.artifacts.findMany({
      where: lt(artifacts.createdAt, cutoffDate),
      columns: {
        id: true,
        storageUrl: true,
        findingId: true,
      },
    });

    logger.info(`[Retention] Found ${oldArtifacts.length} artifacts to clean up`);

    // Step 2: Delete physical files from filesystem
    let filesDeleted = 0;
    let filesFailedToDelete = 0;

    for (const artifact of oldArtifacts) {
      if (artifact.storageUrl) {
        try {
          // Convert storage URL to file path
          // Assuming storage_url is like "/artifacts/{runId}/{findingId}/screenshot.png"
          const filePath = artifact.storageUrl.startsWith('/')
            ? path.join(process.cwd(), artifact.storageUrl.substring(1))
            : path.join(process.cwd(), artifact.storageUrl);

          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            filesDeleted++;
            logger.debug(`[Retention] Deleted file: ${filePath}`);
          }
        } catch (error) {
          filesFailedToDelete++;
          logger.warn(`[Retention] Failed to delete file: ${artifact.storageUrl}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Step 3: Delete artifacts from database (CASCADE will handle finding references)
    const deletedArtifacts = await db
      .delete(artifacts)
      .where(lt(artifacts.createdAt, cutoffDate))
      .returning({ id: artifacts.id });

    logger.info(`[Retention] Deleted ${deletedArtifacts.length} artifact records from database`);

    // Step 4: Delete old findings (artifacts are already cascade-deleted)
    const deletedFindings = await db
      .delete(findings)
      .where(lt(findings.createdAt, cutoffDate))
      .returning({ id: findings.id });

    logger.info(`[Retention] Deleted ${deletedFindings.length} finding records from database`);

    // Step 5: Clean up empty directories
    const artifactsDir = path.join(process.cwd(), 'artifacts');
    if (fs.existsSync(artifactsDir)) {
      cleanupEmptyDirectories(artifactsDir);
    }

    logger.info(`[Retention] Cleanup complete:`, {
      artifactsDeleted: deletedArtifacts.length,
      findingsDeleted: deletedFindings.length,
      filesDeleted,
      filesFailedToDelete,
      cutoffDate: cutoffDate.toISOString(),
      retentionDays,
    });
  } catch (error) {
    logger.error('[Retention] Error during cleanup', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Recursively clean up empty directories
 */
function cleanupEmptyDirectories(directory: string): void {
  if (!fs.existsSync(directory)) {
    return;
  }

  const files = fs.readdirSync(directory);

  // Recursively clean subdirectories first
  for (const file of files) {
    const fullPath = path.join(directory, file);
    if (fs.statSync(fullPath).isDirectory()) {
      cleanupEmptyDirectories(fullPath);
    }
  }

  // Check if directory is now empty
  const remainingFiles = fs.readdirSync(directory);
  if (remainingFiles.length === 0 && directory !== path.join(process.cwd(), 'artifacts')) {
    try {
      fs.rmdirSync(directory);
      logger.debug(`[Retention] Removed empty directory: ${directory}`);
    } catch (error) {
      logger.warn(`[Retention] Failed to remove directory: ${directory}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Main entry point for running cleanup as a standalone script
 */
async function main() {
  logger.info('[Retention] Starting retention cleanup job');

  try {
    await cleanupRetention();
    logger.info('[Retention] Cleanup job completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('[Retention] Cleanup job failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
