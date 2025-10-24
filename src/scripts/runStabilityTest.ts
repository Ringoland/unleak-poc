/**
 * 50-URL Stability Exercise (Day-5)
 * 
 * This script executes a comprehensive stability test to validate:
 * - Retries and circuit breaker functionality
 * - Rules engine matching
 * - Cooldown/deduplication logic
 * - Maintenance window checks
 * - robots.txt validation
 * 
 * Expected mix:
 * - 30 OK URLs (200 status)
 * - 10 FAIL URLs (500/502/503/504 status)
 * - 10 SLOW URLs (3-5 second delays)
 */

import { db } from '../db';
import { runs, findings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';

interface StabilityReport {
  runId: string;
  timestamp: string;
  duration: number; // seconds
  summary: {
    totalUrls: number;
    okCount: number;
    failCount: number;
    slowCount: number;
  };
  findings: {
    total: number;
    byStatus: Record<string, number>;
    withEvidence: number;
  };
  suppressed: {
    total: number;
    byReason: {
      cooldown: number;
      maintenance: number;
      robots: number;
      allowList: number;
    };
  };
  latency: {
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    minMs: number;
    maxMs: number;
  };
  circuitBreaker: {
    tripsObserved: number;
    hostsAffected: string[];
  };
  errors: {
    total: number;
    byType: Record<string, number>;
  };
}

async function createStabilityRun(): Promise<string> {
  // Read allow-list to get all URLs
  const allowListPath = path.join(__dirname, '../config/allow-list.csv');
  const content = await fs.readFile(allowListPath, 'utf-8');
  const lines = content.trim().split('\n').slice(1); // Skip header
  const urls = lines.filter(line => line.trim());

  logger.info(`Creating stability run with ${urls.length} URLs`);

  // Create the run via API (proper contract)
  const axios = (await import('axios')).default;
  const baseUrl = process.env.API_BASE_URL || 'http://localhost:8000';
  
  try {
    const response = await axios.post(`${baseUrl}/api/runs`, {
      urls,
    });
    
    const runId = response.data.id;
    logger.info(`Created run ${runId} with ${urls.length} URLs`, { response: response.data });
    
    return runId;
  } catch (error) {
    logger.error('Failed to create run', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function waitForRunCompletion(runId: string, timeoutMinutes: number = 30): Promise<void> {
  const startTime = Date.now();
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const pollIntervalMs = 5000; // Check every 5 seconds

  logger.info(`Waiting for run ${runId} to complete (timeout: ${timeoutMinutes}m)`);

  while (Date.now() - startTime < timeoutMs) {
    const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);

    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    logger.info(`Run status: ${run.status} (findings: ${run.findingCount}/${run.urlCount})`);

    if (run.status === 'completed' || run.status === 'failed') {
      logger.info(`Run ${runId} finished with status: ${run.status}`);
      return;
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Run ${runId} did not complete within ${timeoutMinutes} minutes`);
}

async function generateReport(runId: string): Promise<StabilityReport> {
  logger.info(`Generating stability report for run ${runId}`);

  // Get run details
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  // Get all findings
  const allFindings = await db.select().from(findings).where(eq(findings.runId, runId));

  // Calculate duration
  const duration = run.completedAt && run.startedAt
    ? (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000
    : 0;

  // Categorize URLs by expected behavior
  const okCount = allFindings.filter(f => 
    f.url.includes('httpstat.us/200') || 
    f.url.includes('example.com') ||
    f.url.includes('iana.org') ||
    f.url.includes('w3.org') ||
    f.url.includes('httpbin.org/get') ||
    f.url.includes('httpbin.org/uuid')
  ).length;

  const failCount = allFindings.filter(f =>
    f.url.includes('/500') ||
    f.url.includes('/502') ||
    f.url.includes('/503') ||
    f.url.includes('/504')
  ).length;

  const slowCount = allFindings.filter(f =>
    f.url.includes('/delay/')
  ).length;

  // Group findings by status
  const byStatus: Record<string, number> = {};
  allFindings.forEach(f => {
    byStatus[f.status] = (byStatus[f.status] || 0) + 1;
  });

  // Count suppressed findings and reasons
  const suppressedFindings = allFindings.filter(f => f.status === 'suppressed');
  const suppressedReasons = {
    cooldown: 0,
    maintenance: 0,
    robots: 0,
    allowList: 0,
  };

  suppressedFindings.forEach(f => {
    if (f.metadata) {
      const meta = f.metadata as any;
      if (meta.suppressionReason) {
        const reason = meta.suppressionReason.toLowerCase();
        if (reason.includes('cooldown') || reason.includes('duplicate')) {
          suppressedReasons.cooldown++;
        } else if (reason.includes('maintenance')) {
          suppressedReasons.maintenance++;
        } else if (reason.includes('robot')) {
          suppressedReasons.robots++;
        } else if (reason.includes('allow')) {
          suppressedReasons.allowList++;
        }
      }
    }
  });

  // Calculate latency statistics from metadata
  const latencies: number[] = [];
  allFindings.forEach(f => {
    if (f.metadata) {
      const meta = f.metadata as any;
      if (meta.fetchLatencyMs) {
        latencies.push(meta.fetchLatencyMs);
      }
    }
  });

  latencies.sort((a, b) => a - b);
  const avgLatency = latencies.length > 0 
    ? latencies.reduce((sum, val) => sum + val, 0) / latencies.length 
    : 0;
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const minLatency = latencies[0] || 0;
  const maxLatency = latencies[latencies.length - 1] || 0;

  // Count findings with evidence (artifacts)
  const withEvidence = allFindings.filter(f => f.status === 'evidence_captured').length;

  // Analyze circuit breaker trips from metadata
  const breakerTrips = new Set<string>();
  allFindings.forEach(f => {
    if (f.metadata) {
      const meta = f.metadata as any;
      if (meta.breakerTripped || meta.circuitBreakerOpen) {
        const host = new URL(f.url).host;
        breakerTrips.add(host);
      }
    }
  });

  // Analyze errors
  const errors: Record<string, number> = {};
  allFindings.forEach(f => {
    if (f.status === 'failed' || f.metadata) {
      const meta = f.metadata as any;
      const errorType = meta?.errorType || 'unknown';
      errors[errorType] = (errors[errorType] || 0) + 1;
    }
  });

  const report: StabilityReport = {
    runId: run.id,
    timestamp: new Date().toISOString(),
    duration,
    summary: {
      totalUrls: run.urlCount,
      okCount,
      failCount,
      slowCount,
    },
    findings: {
      total: allFindings.length,
      byStatus,
      withEvidence,
    },
    suppressed: {
      total: suppressedFindings.length,
      byReason: suppressedReasons,
    },
    latency: {
      avgMs: Math.round(avgLatency),
      p50Ms: Math.round(p50),
      p95Ms: Math.round(p95),
      p99Ms: Math.round(p99),
      minMs: Math.round(minLatency),
      maxMs: Math.round(maxLatency),
    },
    circuitBreaker: {
      tripsObserved: breakerTrips.size,
      hostsAffected: Array.from(breakerTrips),
    },
    errors: {
      total: Object.values(errors).reduce((sum, count) => sum + count, 0),
      byType: errors,
    },
  };

  return report;
}

async function saveReport(report: StabilityReport): Promise<string> {
  const reportsDir = path.join(__dirname, '../../reports');
  
  // Create reports directory if it doesn't exist
  try {
    await fs.mkdir(reportsDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `stability-report-${timestamp}.json`;
  const filepath = path.join(reportsDir, filename);

  await fs.writeFile(filepath, JSON.stringify(report, null, 2), 'utf-8');
  
  logger.info(`Report saved to: ${filepath}`);
  return filepath;
}

function printReport(report: StabilityReport): void {
  console.log('\n' + '='.repeat(80));
  console.log('📊 STABILITY TEST REPORT');
  console.log('='.repeat(80));
  
  console.log(`\n🆔 Run ID: ${report.runId}`);
  console.log(`⏱️  Duration: ${report.duration.toFixed(2)}s`);
  console.log(`📅 Timestamp: ${report.timestamp}`);
  
  console.log('\n📋 SUMMARY');
  console.log(`   Total URLs: ${report.summary.totalUrls}`);
  console.log(`   ✅ OK (200): ${report.summary.okCount} (${Math.round(report.summary.okCount / report.summary.totalUrls * 100)}%)`);
  console.log(`   ❌ FAIL (5xx): ${report.summary.failCount} (${Math.round(report.summary.failCount / report.summary.totalUrls * 100)}%)`);
  console.log(`   🐌 SLOW (delay): ${report.summary.slowCount} (${Math.round(report.summary.slowCount / report.summary.totalUrls * 100)}%)`);
  
  console.log('\n🔍 FINDINGS');
  console.log(`   Total: ${report.findings.total}`);
  console.log(`   By Status:`);
  Object.entries(report.findings.byStatus).forEach(([status, count]) => {
    const percentage = Math.round(count / report.findings.total * 100);
    console.log(`      ${status}: ${count} (${percentage}%)`);
  });
  console.log(`   With Evidence: ${report.findings.withEvidence}`);
  
  console.log('\n🚫 SUPPRESSED');
  console.log(`   Total: ${report.suppressed.total}`);
  console.log(`   By Reason:`);
  console.log(`      Cooldown/Duplicate: ${report.suppressed.byReason.cooldown}`);
  console.log(`      Maintenance Window: ${report.suppressed.byReason.maintenance}`);
  console.log(`      robots.txt: ${report.suppressed.byReason.robots}`);
  console.log(`      Allow-list: ${report.suppressed.byReason.allowList}`);
  
  console.log('\n⚡ LATENCY');
  console.log(`   Average: ${report.latency.avgMs}ms`);
  console.log(`   P50: ${report.latency.p50Ms}ms`);
  console.log(`   P95: ${report.latency.p95Ms}ms`);
  console.log(`   P99: ${report.latency.p99Ms}ms`);
  console.log(`   Min: ${report.latency.minMs}ms`);
  console.log(`   Max: ${report.latency.maxMs}ms`);
  
  console.log('\n🔌 CIRCUIT BREAKER');
  console.log(`   Trips Observed: ${report.circuitBreaker.tripsObserved}`);
  if (report.circuitBreaker.hostsAffected.length > 0) {
    console.log(`   Hosts Affected: ${report.circuitBreaker.hostsAffected.join(', ')}`);
  }
  
  if (report.errors.total > 0) {
    console.log('\n❌ ERRORS');
    console.log(`   Total: ${report.errors.total}`);
    console.log(`   By Type:`);
    Object.entries(report.errors.byType).forEach(([type, count]) => {
      console.log(`      ${type}: ${count}`);
    });
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('✅ Report Complete');
  console.log('='.repeat(80) + '\n');
}

async function main() {
  try {
    console.log('🚀 Starting 50-URL Stability Exercise\n');

    // Step 1: Create run and queue URLs
    console.log('📝 Step 1: Creating run and queueing URLs...');
    const runId = await createStabilityRun();
    console.log(`✅ Run created: ${runId}\n`);

    // Step 2: Wait for completion
    console.log('⏳ Step 2: Waiting for run to complete...');
    await waitForRunCompletion(runId, 30);
    console.log('✅ Run completed\n');

    // Step 3: Generate report
    console.log('📊 Step 3: Generating report...');
    const report = await generateReport(runId);
    console.log('✅ Report generated\n');

    // Step 4: Save report
    console.log('💾 Step 4: Saving report...');
    const filepath = await saveReport(report);
    console.log(`✅ Report saved to: ${filepath}\n`);

    // Step 5: Print report
    printReport(report);

    process.exit(0);
  } catch (error) {
    logger.error('Stability test failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error('\n❌ Stability test failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { createStabilityRun, waitForRunCompletion, generateReport, saveReport, printReport };
