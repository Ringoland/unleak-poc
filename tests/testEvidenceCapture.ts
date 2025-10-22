/**
 * Test script for Evidence Capture with Playwright
 *
 * This script demonstrates the complete evidence capture pipeline:
 * 1. Capture evidence from a URL (screenshot, HAR, HTML, console logs)
 * 2. Save artifacts to storage
 * 3. Record artifacts in database
 *
 * Usage:
 *   npm run test:evidence
 *   or
 *   npx ts-node src/scripts/testEvidenceCapture.ts
 */

import 'dotenv/config';
import { browserService } from '../services/browserService';
import { storageService } from '../services/storageService';
import { artifactService } from '../services/artifactService';
import { db } from '../db';
import { findings, runs } from '../db/schema';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';

async function main() {
  try {
    logger.info('=== Evidence Capture Test Started ===');

    // Initialize storage
    await storageService.initialize();
    logger.info('Storage service initialized');

    // Create a test run
    const [testRun] = await db
      .insert(runs)
      .values({
        submittedAt: new Date(),
        urlCount: 1,
        status: 'queued',
        payload: { test: true, description: 'Evidence capture test' },
      })
      .returning();

    logger.info(`Test run created: ${testRun.id}`);

    // Create a test finding
    const [testFinding] = await db
      .insert(findings)
      .values({
        runId: testRun.id,
        url: 'https://example.com',
        status: 'pending',
        findingType: 'test',
        severity: 'low',
        title: 'Test Finding for Evidence Capture',
        description: 'This is a test finding to demonstrate evidence capture',
        fingerprint: nanoid(),
      })
      .returning();

    logger.info(`Test finding created: ${testFinding.id}`);

    // Capture evidence from a URL
    const testUrl = process.argv[2] || 'https://example.com';
    logger.info(`Capturing evidence from: ${testUrl}`);

    const evidence = await browserService.captureEvidence(testUrl, {
      waitUntil: 'networkidle',
      timeout: 30000,
      captureHAR: true,
    });

    logger.info(`Evidence captured:`);
    logger.info(`  - URL: ${evidence.url}`);
    logger.info(`  - Title: ${evidence.title}`);
    logger.info(`  - Screenshot: ${evidence.screenshot.length} bytes`);
    logger.info(`  - HTML: ${evidence.html.length} bytes`);
    logger.info(`  - Console logs: ${evidence.consoleLogs.length} entries`);
    logger.info(`  - HAR: ${evidence.har ? 'Yes' : 'No'}`);
    logger.info(`  - Load time: ${evidence.metadata.loadTime}ms`);

    // Save artifacts
    logger.info('Saving artifacts...');

    let savedArtifacts = [];
    const artifactInputs = [
      {
        findingId: testFinding.id,
        type: 'screenshot' as const,
        data: evidence.screenshot,
      },
      {
        findingId: testFinding.id,
        type: 'html' as const,
        data: evidence.html,
      },
      {
        findingId: testFinding.id,
        type: 'console_logs' as const,
        data: evidence.consoleLogs,
      },
    ];

    // HAR is optional, only add if captured
    if (evidence.har) {
      logger.info('  - HAR file captured, saving...');
      const harArtifact = await artifactService.saveArtifact({
        findingId: testFinding.id,
        type: 'har',
        data: evidence.har,
      });
      savedArtifacts.push(harArtifact);
    }

    // Now save the standard artifacts
    const standardArtifacts = await artifactService.saveArtifacts(artifactInputs);
    savedArtifacts = [...savedArtifacts, ...standardArtifacts];

    logger.info(`Saved ${savedArtifacts.length} artifacts:`);
    for (const artifact of savedArtifacts) {
      logger.info(`  - ${artifact.type}: ${artifact.storageUrl} (${artifact.size} bytes)`);
    }

    // Display storage stats
    const stats = await artifactService.getStorageStats();
    logger.info(`Storage stats:`);
    logger.info(`  - Total artifacts: ${stats.totalArtifacts}`);
    logger.info(`  - Total size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`);
    logger.info(`  - By type:`);
    for (const [type, typeStats] of Object.entries(stats.byType)) {
      logger.info(
        `    - ${type}: ${typeStats.count} files, ${(typeStats.size / 1024).toFixed(2)} KB`
      );
    }

    // Test retrieval
    logger.info('Testing artifact retrieval...');
    const retrievedArtifacts = await artifactService.getArtifactsByFindingId(testFinding.id);
    logger.info(`Retrieved ${retrievedArtifacts.length} artifacts for finding ${testFinding.id}`);

    // Display console logs if any
    if (evidence.consoleLogs.length > 0) {
      logger.info('Console logs captured:');
      evidence.consoleLogs.slice(0, 10).forEach((log, index) => {
        logger.info(`  ${index + 1}. [${log.type}] ${log.text}`);
      });
      if (evidence.consoleLogs.length > 10) {
        logger.info(`  ... and ${evidence.consoleLogs.length - 10} more`);
      }
    }

    logger.info('=== Evidence Capture Test Completed Successfully ===');

    // Close browser
    await browserService.close();

    process.exit(0);
  } catch (error) {
    logger.error('Test failed:', error);
    await browserService.close();
    process.exit(1);
  }
}

main();
