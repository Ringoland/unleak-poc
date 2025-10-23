import fs from 'fs/promises';
import path from 'path';
import { printReport } from './runStabilityTest';

interface StabilityReport {
  runId: string;
  timestamp: string;
  duration: number;
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

async function findLatestReport(): Promise<string | null> {
  const reportsDir = path.join(__dirname, '../../reports');
  
  try {
    const files = await fs.readdir(reportsDir);
    const reportFiles = files
      .filter(f => f.startsWith('stability-report-') && f.endsWith('.json'))
      .sort()
      .reverse();
    
    if (reportFiles.length === 0) {
      return null;
    }
    
    return path.join(reportsDir, reportFiles[0]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function main() {
  try {
    console.log('🔍 Looking for latest stability report...\n');
    
    const reportPath = await findLatestReport();
    
    if (!reportPath) {
      console.log('❌ No stability reports found in reports/ directory');
      console.log('\nRun a stability test first:');
      console.log('  pnpm stability\n');
      process.exit(1);
    }
    
    console.log(`📄 Found: ${path.basename(reportPath)}\n`);
    
    const content = await fs.readFile(reportPath, 'utf-8');
    const report: StabilityReport = JSON.parse(content);
    
    printReport(report);
    
    console.log(`\n📁 Full report: ${reportPath}\n`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error reading report:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { findLatestReport };
