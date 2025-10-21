import { Counter, Histogram, Gauge, Registry, register as defaultRegister } from 'prom-client';
import { logger } from './logger';

// Create a custom registry (or use the default one)
export const metricsRegistry: Registry = defaultRegister;

// ===== Counters =====

/**
 * Total number of runs created
 */
export const runsCreatedCounter = new Counter({
  name: 'unleak_runs_created_total',
  help: 'Total number of scan runs created',
  labelNames: ['runType'],
  registers: [metricsRegistry],
});

/**
 * HTTP response status codes
 */
export const httpResponseStatusCounter = new Counter({
  name: 'unleak_http_response_status_total',
  help: 'HTTP response status codes from fetcher',
  labelNames: ['statusCode', 'targetId'],
  registers: [metricsRegistry],
});

/**
 * Circuit breaker state changes
 */
export const breakerStateChangesCounter = new Counter({
  name: 'unleak_breaker_state_changes_total',
  help: 'Circuit breaker state transitions',
  labelNames: ['targetId', 'fromState', 'toState'],
  registers: [metricsRegistry],
});

/**
 * Breaker requests blocked (circuit open)
 */
export const breakerRequestsBlockedCounter = new Counter({
  name: 'unleak_breaker_requests_blocked_total',
  help: 'Number of requests blocked by open circuit breakers',
  labelNames: ['targetId'],
  registers: [metricsRegistry],
});

/**
 * Slack alerts sent
 */
export const slackAlertsSentCounter = new Counter({
  name: 'unleak_slack_alerts_sent_total',
  help: 'Total number of Slack alerts sent',
  labelNames: ['alertType'], // '5xx', 'latency', 'timeout', 'network'
  registers: [metricsRegistry],
});

/**
 * Re-verify requests
 */
export const reverifyRequestsCounter = new Counter({
  name: 'unleak_reverify_requests_total',
  help: 'Total number of re-verify requests',
  labelNames: ['status'], // 'accepted', 'duplicate_ttl', 'rate_limited'
  registers: [metricsRegistry],
});

/**
 * Findings created
 */
export const findingsCreatedCounter = new Counter({
  name: 'unleak_findings_created_total',
  help: 'Total number of findings created',
  labelNames: ['severity', 'findingType'],
  registers: [metricsRegistry],
});

// ===== Histograms =====

/**
 * HTTP request latency in milliseconds
 */
export const httpRequestLatencyHistogram = new Histogram({
  name: 'unleak_http_request_duration_ms',
  help: 'HTTP request latency in milliseconds',
  labelNames: ['targetId', 'statusCode'],
  buckets: [50, 100, 250, 500, 1000, 1500, 2000, 3000, 5000, 10000],
  registers: [metricsRegistry],
});

/**
 * Run duration (time from submitted to completed)
 */
export const runDurationHistogram = new Histogram({
  name: 'unleak_run_duration_seconds',
  help: 'Duration of scan runs in seconds',
  labelNames: ['status', 'runType'],
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [metricsRegistry],
});

/**
 * Queue job processing time
 */
export const queueJobDurationHistogram = new Histogram({
  name: 'unleak_queue_job_duration_ms',
  help: 'Queue job processing duration in milliseconds',
  labelNames: ['jobType', 'status'],
  buckets: [100, 500, 1000, 2000, 5000, 10000, 30000],
  registers: [metricsRegistry],
});

// ===== Gauges =====

/**
 * Current number of active runs
 */
export const activeRunsGauge = new Gauge({
  name: 'unleak_active_runs',
  help: 'Current number of active (non-completed) runs',
  registers: [metricsRegistry],
});

/**
 * Circuit breaker states (open/closed/half_open)
 */
export const breakerStateGauge = new Gauge({
  name: 'unleak_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half_open, 2=open)',
  labelNames: ['targetId', 'state'],
  registers: [metricsRegistry],
});

/**
 * Queue depth (pending jobs)
 */
export const queueDepthGauge = new Gauge({
  name: 'unleak_queue_depth',
  help: 'Number of pending jobs in the queue',
  labelNames: ['queueName'],
  registers: [metricsRegistry],
});

// ===== Helper Functions =====

/**
 * Record an HTTP request
 */
export function recordHttpRequest(
  targetId: string,
  statusCode: number | null,
  latencyMs: number
): void {
  try {
    const status = statusCode?.toString() || 'unknown';
    
    httpResponseStatusCounter.labels(status, targetId).inc();
    
    if (latencyMs > 0) {
      httpRequestLatencyHistogram.labels(targetId, status).observe(latencyMs);
    }
  } catch (error) {
    logger.error('[Metrics] Error recording HTTP request', { error });
  }
}

/**
 * Record a circuit breaker state change
 */
export function recordBreakerStateChange(
  targetId: string,
  fromState: string,
  toState: string
): void {
  try {
    breakerStateChangesCounter.labels(targetId, fromState, toState).inc();
    
    // Update gauge
    const stateValue = toState === 'closed' ? 0 : toState === 'half_open' ? 1 : 2;
    breakerStateGauge.labels(targetId, toState).set(stateValue);
  } catch (error) {
    logger.error('[Metrics] Error recording breaker state change', { error });
  }
}

/**
 * Record a blocked request (circuit open)
 */
export function recordBlockedRequest(targetId: string): void {
  try {
    breakerRequestsBlockedCounter.labels(targetId).inc();
  } catch (error) {
    logger.error('[Metrics] Error recording blocked request', { error });
  }
}

/**
 * Record a Slack alert sent
 */
export function recordSlackAlert(alertType: string): void {
  try {
    slackAlertsSentCounter.labels(alertType).inc();
  } catch (error) {
    logger.error('[Metrics] Error recording Slack alert', { error });
  }
}

/**
 * Record a re-verify request
 */
export function recordReverifyRequest(status: string): void {
  try {
    reverifyRequestsCounter.labels(status).inc();
  } catch (error) {
    logger.error('[Metrics] Error recording reverify request', { error });
  }
}

/**
 * Record a run created
 */
export function recordRunCreated(runType: string): void {
  try {
    runsCreatedCounter.labels(runType).inc();
  } catch (error) {
    logger.error('[Metrics] Error recording run created', { error });
  }
}

/**
 * Record a finding created
 */
export function recordFindingCreated(severity: string, findingType: string): void {
  try {
    findingsCreatedCounter.labels(severity, findingType).inc();
  } catch (error) {
    logger.error('[Metrics] Error recording finding created', { error });
  }
}

/**
 * Update active runs gauge
 */
export function updateActiveRuns(count: number): void {
  try {
    activeRunsGauge.set(count);
  } catch (error) {
    logger.error('[Metrics] Error updating active runs', { error });
  }
}

/**
 * Update queue depth gauge
 */
export function updateQueueDepth(queueName: string, depth: number): void {
  try {
    queueDepthGauge.labels(queueName).set(depth);
  } catch (error) {
    logger.error('[Metrics] Error updating queue depth', { error });
  }
}

/**
 * Get all metrics in Prometheus format
 */
export async function getMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
  metricsRegistry.resetMetrics();
}
