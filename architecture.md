# Unleak PoC - System Architecture

**Version:** 1.0  
**Date:** October 16, 2025  
**Status:** In Development

---

## 1. Overview

The **Unleak Proof of Concept (PoC)** is an automated pipeline that crawls target URLs, renders them with Playwright, detects blocked form submissions, verifies findings against a mock CRM, and sends Slack alerts to brand owners.

### Key Objectives

- **10-Day PoC Timeline**: Deliver an end-to-end working detector for `form.submit_blocked` events
- **Automated Detection**: Identify when legitimate form submissions are blocked by security tools
- **Verification Pipeline**: Confirm real issues by cross-referencing against a mock CRM endpoint
- **Actionable Alerts**: Provide Slack notifications with evidence (screenshots, HAR files, console logs, HTML)
- **Re-verification Support**: Allow security teams to manually trigger re-scans via Slack buttons

### Core Detection Logic

The initial detector (`form.submit_blocked`) identifies scenarios where:
- A form submission is blocked by a WAF/bot detection tool
- The user/request would be legitimate according to the CRM
- Evidence is captured to support the finding

---

## 2. System Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Unleak PoC System                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐ │
│  │  API Service │◄────►│   Database   │◄────►│    Redis     │ │
│  │  (Express)   │      │ (PostgreSQL) │      │   (Cache)    │ │
│  └──────┬───────┘      └──────────────┘      └──────┬───────┘ │
│         │                                             │         │
│         │                                             │         │
│  ┌──────▼──────────────────────────────────────────┬─▼───────┐ │
│  │              BullMQ Job Queues                  │ Circuit │ │
│  │  crawl → render → detect → verify → alert       │ Breaker │ │
│  └──────┬──────────────────────────────────────────┴─────────┘ │
│         │                                                       │
│  ┌──────▼───────────────────────────────────────────────────┐  │
│  │                    Worker Processes                      │  │
│  │  • Crawler Worker    • Detector Worker                   │  │
│  │  • Renderer Worker   • Verifier Worker                   │  │
│  │  • Alert Worker      • Rules Service                     │  │
│  └──────┬───────────────────────────────────────────────────┘  │
│         │                                                       │
│  ┌──────▼───────────────────────────────────────────────────┐  │
│  │            External Integrations                         │  │
│  │  • Slack (Alerts & Actions)  • S3/Local (Artifacts)      │  │
│  │  • Playwright (Rendering)    • Mock CRM (Verification)   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Service Descriptions

#### **API Service**
- **Technology**: Express.js (TypeScript)
- **Purpose**: HTTP endpoints for external interactions
- **Key Endpoints**:
  - `POST /api/runs` - Create new scan runs
  - `GET /api/runs/:id` - Fetch run status and results
  - `POST /api/findings/:id/reverify` - Re-verify a finding (with idempotency)
  - `POST /api/slack/actions` - Handle Slack button interactions
  - `GET /metrics` - Prometheus metrics endpoint

#### **Crawler Worker**
- **Technology**: BullMQ Worker
- **Purpose**: Fetch target URLs from database and enqueue rendering jobs
- **Process**:
  1. Queries active targets from PostgreSQL
  2. Applies brand-specific rules (maintenance windows, cooldowns)
  3. Creates jobs in `renderQueue` with target metadata

#### **Renderer Worker**
- **Technology**: BullMQ Worker + Playwright
- **Purpose**: Load URLs in a real browser and capture evidence
- **Process**:
  1. Launches Playwright browser (Chromium)
  2. Navigates to target URL
  3. Captures:
     - Screenshot (PNG)
     - HAR file (network activity)
     - HTML source
     - Console logs (errors, warnings)
  4. Saves artifacts to local storage or S3
  5. Records metadata in `artifacts` table
  6. Passes job to `detectQueue`

#### **Detector Worker**
- **Technology**: BullMQ Worker
- **Purpose**: Run detection logic against rendered pages
- **Detectors** (initially):
  - `form.submit_blocked`: Checks for blocked form submissions
- **Process**:
  1. Loads artifacts (HTML, console logs, HAR)
  2. Applies detector logic (regex, DOM analysis, network patterns)
  3. Creates findings in database if issues detected
  4. Passes findings to `verifyQueue`

#### **Verifier Worker**
- **Technology**: BullMQ Worker + HTTP Client
- **Purpose**: Validate findings against mock CRM endpoint
- **Process**:
  1. Extracts user identifiers from finding data
  2. Calls mock CRM API: `POST /verify`
  3. Records verification result in `verifications` table
  4. If verified (legitimate user), enqueues alert job
  5. Tracks latency metrics for observability

#### **Slack Service**
- **Technology**: Slack Bolt SDK
- **Purpose**: Send alerts and handle interactive actions
- **Alert Flow**:
  1. Receives verified finding from `alertQueue`
  2. Formats Slack Block Kit message with:
     - Finding summary
     - Evidence links (screenshot, HAR, HTML)
     - "Re-verify" button
  3. Posts to brand's Slack channel
- **Action Flow**:
  1. User clicks "Re-verify" button
  2. Slack sends action payload to `/api/slack/actions`
  3. API enqueues reverify job with idempotency key
  4. Replies with status update in Slack thread

#### **Rules Service**
- **Technology**: In-memory cache + Redis
- **Purpose**: Load and apply brand-specific rulesets
- **Features**:
  - Enable/disable detectors per brand
  - Configure priority levels
  - Set cooldown periods (e.g., 24h between alerts)
  - Define maintenance windows (suppress alerts)
  - Cache rules in Redis for fast access

#### **Metrics UI**
- **Technology**: React/Next.js + Prometheus/Grafana (planned)
- **Purpose**: Observability dashboard
- **Displays**:
  - Success rate per queue
  - Verification latency (P50, P95, P99)
  - Top error codes
  - Circuit breaker states (open/closed/half-open)
  - Job throughput and queue depth

---

## 3. Queue & Job Flow

### Queue Pipeline

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ crawlQueue   │────►│ renderQueue  │────►│ detectQueue  │
└──────────────┘     └──────────────┘     └──────────────┘
                                                  │
                                                  ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ alertQueue   │◄────│ verifyQueue  │◄────│ (continued)  │
└──────────────┘     └──────────────┘     └──────────────┘
```

### Job Configuration

All queues use BullMQ with the following defaults:

```typescript
{
  attempts: 3,              // Retry failed jobs 3 times
  backoff: {
    type: 'exponential',
    delay: 1000             // 1s, 2s, 4s (capped at 20s)
  },
  removeOnComplete: 100,    // Keep last 100 completed jobs
  removeOnFail: 500         // Keep last 500 failed jobs
}
```

### Circuit Breaker

- **Implementation**: Redis-backed state machine
- **States**:
  - **Closed**: Normal operation, jobs flow through
  - **Open**: Too many failures, jobs rejected immediately
  - **Half-Open**: Testing if system recovered
- **Threshold**: 5 failures in 60 seconds triggers open state
- **Recovery**: After 30 seconds, enter half-open; 3 successes → closed
- **Scope**: Per-target or per-brand

### Error Handling

- **Transient Errors**: Network timeouts, rate limits → retry
- **Permanent Errors**: Invalid URLs, missing config → dead letter queue
- **Monitoring**: Failed jobs logged with full context (job ID, payload, error stack)

---

## 4. Database Schema

### Technology

- **ORM**: Drizzle ORM
- **Database**: PostgreSQL 15+
- **Migrations**: Stored in `/drizzle` directory

### Core Tables

#### `accounts`
```typescript
{
  id: uuid (PK),
  name: string,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

#### `brands`
```typescript
{
  id: uuid (PK),
  accountId: uuid (FK → accounts),
  name: string,
  slackChannel: string,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

#### `targets`
```typescript
{
  id: uuid (PK),
  brandId: uuid (FK → brands),
  url: string,
  enabled: boolean,
  lastScannedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

#### `runs`
```typescript
{
  id: uuid (PK),
  status: string,                      // e.g., 'queued', 'running', 'completed'
  runType: string,                     // e.g., 'scheduled', 'manual'
  submittedAt: timestamp,
  startedAt: timestamp | null,
  completedAt: timestamp | null,
  urlCount: integer,                   // Number of URLs scanned
  findingCount: integer,               // Number of findings detected
  payload: jsonb | null,               // Input payload for the run
  error: jsonb | null,                 // Error details if failed
  createdAt: timestamp,
  updatedAt: timestamp
}
```

#### `findings`
```typescript
{
  id: uuid (PK),
  runId: uuid (FK → runs.id),
  url: string,                         // Target URL
  status: string,                      // e.g., 'pending', 'verified'
  findingType: string | null,          // Type/category of finding
  severity: string | null,             // e.g., 'low', 'medium', 'high'
  title: string | null,                // Short summary
  description: text | null,            // Detailed description
  detectedValue: text | null,          // Extracted or matched value
  context: text | null,                // Context info (DOM snippet, etc.)
  fingerprint: string | null,          // Unique identifier per finding
  falsePositive: boolean,              // Marked as false positive
  verified: boolean,                   // Verified by reverification
  metadata: jsonb | null,              // Arbitrary key/value data
  createdAt: timestamp,
  updatedAt: timestamp
}
```

#### `artifacts`
```typescript
{
  id: uuid (PK),
  findingId: uuid (FK → findings),
  type: enum (screenshot, har, html, console_logs),
  storageUrl: string,             // S3 URL or local path
  size: integer,                  // Bytes
  createdAt: timestamp,
  expiresAt: timestamp            // Retention policy: 7 days
}
```

#### `verifications`
```typescript
{
  id: uuid (PK),
  findingId: uuid (FK → findings),
  crmResult: jsonb,               // Mock CRM response
  isLegitimate: boolean,
  latencyMs: integer,
  createdAt: timestamp
}
```

#### `rulesets`
```typescript
{
  id: uuid (PK),
  brandId: uuid (FK → brands),
  detectorType: string,
  enabled: boolean,
  priority: integer,
  cooldownHours: integer,         // Hours between alerts
  maintenanceWindows: jsonb,      // [{start, end}, ...]
  config: jsonb,                  // Detector-specific settings
  createdAt: timestamp,
  updatedAt: timestamp
}
```

#### `breaker_states`
```typescript
{
  id: serial (PK),
  serviceName: string,                 // Unique service identifier
  state: string,                       // e.g., 'closed', 'open', 'half_open'
  failureCount: integer,               // Consecutive failures
  openedAt: timestamp | null,          // When breaker was opened
  nextAttemptAt: timestamp | null,     // Next retry time
  lastError: string | null,            // Last error message
  successCount: integer,               // Successful requests count
  isActive: boolean,                   // Whether breaker is enabled
  createdAt: timestamp,
  updatedAt: timestamp
}
```

#### `reverify_keys`
```typescript
{
  idempotencyKey: string (PK),
  findingId: uuid (FK → findings.id),
  status: string,                      // e.g., 'accepted', 'rate_limited'
  createdAt: timestamp,
  expiresAt: timestamp,                // TTL expiration time
  completedAt: timestamp | null        // When reverification completed
}
```

#### `reverify_counters`
```typescript
{
  id: serial (PK),
  findingId: uuid (FK → findings.id),
  windowStart: timestamp,              // Beginning of rate window
  windowEnd: timestamp,                // End of rate window
  requestCount: integer,               // Number of reverification requests
  lastRequestAt: timestamp | null,     // Last request time
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Foreign Key Relations

```
accounts (1) ──► (N) brands
brands (1) ──► (N) targets
brands (1) ──► (N) rulesets
targets (1) ──► (N) findings
runs (1) ──► (N) findings
findings (1) ──► (N) artifacts
findings (1) ──► (1) verifications
findings (1) ──► (N) reverify_keys
findings (1) ──► (N) reverify_counters
```

### Retention Policy

- **Artifacts**: Automatically deleted after 7 days (`expiresAt` field)
- **Completed Jobs**: Last 100 kept in BullMQ
- **Failed Jobs**: Last 500 kept for debugging
- **Logs**: Rotated daily, kept for 30 days

---

## 5. Evidence Pipeline

### Step-by-Step Flow

#### 1. Target Selection
- Crawler fetches active targets from database
- Filters by brand rules (enabled, not in maintenance window)
- Checks cooldown periods (skip if scanned too recently)

#### 2. Page Rendering
```typescript
// Renderer Worker Process
1. Launch Playwright browser context
2. Enable HAR recording
3. Attach console log listener
4. Navigate to target URL
5. Wait for page load (networkidle or domcontentloaded)
6. Take full-page screenshot
7. Extract HTML source
8. Close browser context
```

#### 3. Artifact Capture

**Screenshot**:
- Format: PNG
- Full-page capture (scrolls to capture entire page)
- Stored locally: `/artifacts/screenshots/{findingId}.png`
- Or S3: `s3://unleak-artifacts/screenshots/{findingId}.png`

**HAR (HTTP Archive)**:
- Contains all network requests/responses
- Includes headers, cookies, timing data
- Stored as JSON: `/artifacts/har/{findingId}.har`

**HTML Source**:
- Raw HTML after JavaScript execution
- Compressed (gzip): `/artifacts/html/{findingId}.html.gz`

**Console Logs**:
- Errors, warnings, info messages
- Stored as JSON: `/artifacts/logs/{findingId}.json`

#### 4. Metadata Recording

```typescript
// Database Insert
await db.insert(artifacts).values({
  id: nanoid(),
  findingId: findingId,
  type: 'screenshot',
  storageUrl: artifactUrl,
  size: fileStats.size,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
});
```

#### 5. Job Handoff

```typescript
// Pass to next queue
await detectQueue.add('detect', {
  findingId: findingId,
  artifactIds: [screenshotId, harId, htmlId, logsId],
  targetUrl: job.data.url,
  timestamp: new Date().toISOString()
});
```

### Evidence Access

- **Slack Alerts**: Include pre-signed URLs (1-hour expiry)
- **Metrics UI**: Displays thumbnails + download links
- **API**: `GET /api/findings/:id/evidence` returns artifact URLs

---

## 6. Rules & Config

### Ruleset Structure

```typescript
interface Ruleset {
  id: string;
  brandId: string;
  detectorType: 'form.submit_blocked' | 'rate_limit' | 'captcha_loop';
  enabled: boolean;
  priority: number;            // 1-10 (higher = more urgent)
  cooldownHours: number;       // Min hours between alerts
  maintenanceWindows: {
    start: string;             // ISO 8601 datetime
    end: string;
  }[];
  config: {
    // Detector-specific settings
    threshold?: number;
    excludePatterns?: string[];
  };
}
```

### Rule Application

#### 1. Load Rules
```typescript
// On worker startup
const rules = await db.select().from(rulesets).where(eq(rulesets.brandId, brandId));
await redis.setex(`rules:${brandId}`, 3600, JSON.stringify(rules));
```

#### 2. Check Enabled Status
```typescript
if (!ruleset.enabled) {
  logger.info(`Detector ${detectorType} disabled for brand ${brandId}`);
  return; // Skip detection
}
```

#### 3. Apply Cooldown
```typescript
const lastAlertKey = `cooldown:${brandId}:${detectorType}`;
const lastAlert = await redis.get(lastAlertKey);

if (lastAlert) {
  const hoursSince = (Date.now() - parseInt(lastAlert)) / 3600000;
  if (hoursSince < ruleset.cooldownHours) {
    logger.info(`Cooldown active, skipping alert`);
    return;
  }
}

// Record new alert
await redis.setex(lastAlertKey, ruleset.cooldownHours * 3600, Date.now().toString());
```

#### 4. Maintenance Suppression
```typescript
const now = new Date();
const inMaintenance = ruleset.maintenanceWindows.some(window => {
  return now >= new Date(window.start) && now <= new Date(window.end);
});

if (inMaintenance) {
  logger.info(`Suppressing alert during maintenance window`);
  return;
}
```

### Configuration Management

- **Admin API** (future): `PUT /api/rulesets/:id` to update rules
- **Validation**: Schema validation on create/update
- **Cache Invalidation**: Redis cache cleared on rule changes
- **Audit Log**: All rule changes tracked in `audit_logs` table

---

## 7. Slack Flow

### Alert Message

**Slack Block Kit Example**:
```json
{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "🚨 Form Submission Blocked"
      }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Severity:* High" },
        { "type": "mrkdwn", "text": "*URL:* example.com/signup" },
        { "type": "mrkdwn", "text": "*Detector:* form.submit_blocked" },
        { "type": "mrkdwn", "text": "*Verified:* Yes (CRM match)" }
      ]
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Evidence:*\n• <https://s3.../screenshot.png|Screenshot>\n• <https://s3.../trace.har|HAR File>\n• <https://s3.../page.html|HTML Source>"
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Re-verify" },
          "value": "finding_id_123",
          "action_id": "reverify_finding"
        }
      ]
    }
  ]
}
```

### Re-verify Action Flow

1. **User Clicks Button**
   - Slack sends POST to `/api/slack/actions`
   - Payload includes `action_id` and `value` (finding ID)

2. **API Handling**
   ```typescript
   router.post('/slack/actions', async (req, res) => {
     const { action_id, value } = req.body;
     const idempotencyKey = `slack:${req.body.user.id}:${value}:${Date.now()}`;
     
     // Call internal reverify endpoint
     await axios.post(`/api/findings/${value}/reverify`, null, {
       headers: { 'Idempotency-Key': idempotencyKey }
     });
     
     res.json({ ok: true });
   });
   ```

3. **Idempotency Check**
   - Redis key: `reverify:{idempotencyKey}`
   - TTL: 120 seconds
   - Returns `duplicate_ttl` if key exists

4. **Rate Limiting**
   - Redis counter: `reverify:rate:{findingId}`
   - Limit: 5 requests per hour
   - Returns `rate_limited` if exceeded

5. **Job Enqueue**
   ```typescript
   await verifyQueue.add('reverify', {
     findingId: findingId,
     reason: 'manual_slack_trigger',
     userId: slackUserId
   });
   ```

6. **Result Notification**
   - Worker posts update to original Slack thread
   - Status: ✅ Verified, ❌ Not Verified, ⚠️ Error

### Slack App Configuration

- **OAuth Scopes**: `chat:write`, `commands`, `users:read`
- **Bot Token**: Stored in environment variable `SLACK_BOT_TOKEN`
- **Signing Secret**: Used to verify webhook signatures
- **Install Per Brand**: Each brand has its own Slack workspace integration

---

## 8. Observability

### Metrics Endpoint

**Prometheus Format** (`GET /metrics`):
```
# HELP unleak_jobs_total Total number of jobs processed
# TYPE unleak_jobs_total counter
unleak_jobs_total{queue="render",status="completed"} 1234
unleak_jobs_total{queue="render",status="failed"} 56

# HELP unleak_verify_latency_ms Verification latency in milliseconds
# TYPE unleak_verify_latency_ms histogram
unleak_verify_latency_ms_bucket{le="100"} 500
unleak_verify_latency_ms_bucket{le="500"} 800
unleak_verify_latency_ms_bucket{le="1000"} 950
unleak_verify_latency_ms_sum 123456
unleak_verify_latency_ms_count 1000

# HELP unleak_circuit_breaker_state Circuit breaker state (0=closed, 1=open, 2=half-open)
# TYPE unleak_circuit_breaker_state gauge
unleak_circuit_breaker_state{target="example.com"} 0
```

### Metrics Dashboard

**Key Visualizations**:
1. **Success Rate**: `(completed / (completed + failed)) * 100`
2. **Queue Depth**: Current jobs waiting per queue
3. **Latency Percentiles**: P50, P95, P99 for verify operations
4. **Error Breakdown**: Top 10 error codes with counts
5. **Circuit Breaker States**: Table of targets with breaker status

### Logging

**Structured Logs** (JSON format):
```json
{
  "level": "info",
  "timestamp": "2025-10-16T12:34:56.789Z",
  "jobId": "render-abc123",
  "findingId": "finding-xyz789",
  "message": "Page rendered successfully",
  "duration": 3421,
  "url": "https://example.com/form"
}
```

**Log Levels**:
- `error`: Failures requiring immediate attention
- `warn`: Retryable errors, degraded performance
- `info`: Normal operations, job lifecycle events
- `debug`: Detailed execution traces (disabled in production)

**Grouping**: Logs tagged with `jobId` for tracing across workers

### Alerting (Future)

- **Slack Alerts** (to internal ops channel):
  - Circuit breaker opens
  - Queue depth exceeds threshold
  - Verification latency P99 > 5s
- **PagerDuty**: Critical system failures

---

## 9. Acceptance-Gate Plan

The PoC must pass **6 acceptance gates**, with **Gate #3** (E2E Detector) being mandatory.

### Gate #1: Basic Infrastructure
**Criteria**:
- ✅ PostgreSQL + Drizzle ORM connected
- ✅ Redis connected
- ✅ BullMQ queues initialized
- ✅ API server responds to health checks

**Validation**:
```bash
npm run dev
curl http://localhost:3000/ok
# Expected: {"ok": true}
```

### Gate #2: Evidence Capture
**Criteria**:
- ✅ Playwright renders target URL
- ✅ Screenshot captured and saved
- ✅ HAR file recorded
- ✅ Console logs extracted
- ✅ Artifacts stored locally or S3

**Validation**:
- Run single render job: `npm run test:queue`
- Verify artifacts exist in `/artifacts` or S3 bucket

### Gate #3: E2E Detector (Mandatory)
**Criteria**:
- ✅ `form.submit_blocked` detector implemented
- ✅ Detects blocked submissions in test environment
- ✅ Creates finding in database
- ✅ Verification call to mock CRM succeeds
- ✅ Slack alert sent with evidence links

**Validation**:
1. Deploy test target with intentionally blocked form
2. Trigger scan: `POST /api/runs`
3. Verify finding created: `GET /api/runs/:id`
4. Confirm Slack message received in test channel

### Gate #4: Re-verification
**Criteria**:
- ✅ "Re-verify" Slack button functional
- ✅ Idempotency prevents duplicate reverifications
- ✅ Rate limiting enforced (5 requests/hour)
- ✅ Result posted back to Slack thread

**Validation**:
1. Click "Re-verify" button in Slack alert
2. Click again within 120s → expect `duplicate_ttl`
3. Wait 120s, click 5 more times → 6th click returns `rate_limited`

### Gate #5: Smoke Test (50 URLs)
**Criteria**:
- ✅ System processes 50 target URLs without crashes
- ✅ Success rate > 80%
- ✅ All jobs complete within 10 minutes
- ✅ No memory leaks (heap stable)

**Validation**:
1. Load 50 test URLs into `targets` table
2. Trigger crawl: `POST /api/runs`
3. Monitor metrics dashboard
4. Verify all jobs completed: `GET /api/runs/:id`

### Gate #6: Observability
**Criteria**:
- ✅ Metrics endpoint returns data
- ✅ Success rate calculated correctly
- ✅ Verify latency P50, P95, P99 tracked
- ✅ Circuit breaker states visible
- ✅ Logs grouped by job ID

**Validation**:
1. Access `/metrics` endpoint
2. Verify Prometheus scraping works
3. Check Grafana dashboard (if configured)
4. Trigger circuit breaker by failing 5+ jobs
5. Confirm state change in metrics

### Acceptance Checklist

| Gate | Status | Blocker? | Notes |
|------|--------|----------|-------|
| #1 Infrastructure | ✅ Pass | No | All services connected |
| #2 Evidence | 🟡 In Progress | No | S3 integration pending |
| #3 E2E Detector | 🔴 Not Started | **YES** | Mandatory for PoC |
| #4 Re-verify | 🔴 Not Started | No | Depends on Gate #3 |
| #5 Smoke Test | 🔴 Not Started | No | Run after Gate #3 |
| #6 Observability | 🟡 In Progress | No | Metrics endpoint live |

---

## 10. Tech Stack

### Backend
- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.9+
- **Framework**: Express.js 5.x
- **ORM**: Drizzle ORM 0.44+
- **Database**: PostgreSQL 15+
- **Cache/Queue**: Redis 7+ (via ioredis)
- **Job Queue**: BullMQ 5.x
- **Browser Automation**: Playwright 1.49+

### Integrations
- **Slack**: Slack Bolt SDK
- **Object Storage**: AWS S3 SDK (or local filesystem)
- **Metrics**: prom-client (Prometheus)
- **HTTP Client**: Axios

### Frontend (Planned)
- **Framework**: Next.js 14+ (React 18)
- **UI Library**: Tailwind CSS
- **Charts**: Recharts or Chart.js
- **State Management**: React Query (TanStack Query)

### Development Tools
- **Package Manager**: pnpm
- **Build**: TypeScript Compiler (tsc)
- **Dev Server**: ts-node-dev (hot reload)
- **Testing**: Jest + ts-jest
- **Linting**: ESLint + Prettier
- **Git Hooks**: Husky (planned)

### Infrastructure (Deployment)
- **Containerization**: Docker + Docker Compose
- **Orchestration**: Kubernetes (future) or single VPS
- **CI/CD**: GitHub Actions
- **Monitoring**: Prometheus + Grafana (planned)
- **Logging**: Winston or Pino → Loki (planned)

---

## 11. Folder Structure

### Current Structure
```
/unleak-poc
├── config/
│   └── allow-list.csv          # Allowlist for verification
├── docs/
│   └── architecture.md         # This document
├── drizzle/
│   ├── 0000_naive_ultragirl.sql
│   └── meta/
│       ├── _journal.json
│       └── 0000_snapshot.json
├── scripts/
│   └── smoke.ps1               # Windows smoke test
├── src/
│   ├── index.ts                # Main entry point
│   ├── api/
│   │   ├── index.ts            # Express app setup
│   │   ├── middleware/
│   │   │   ├── bullBoardAuth.ts
│   │   │   └── errorHandler.ts
│   │   └── routes/
│   │       ├── findings.ts     # /api/findings endpoints
│   │       ├── runs.ts         # /api/runs endpoints
│   │       └── slack.ts        # /api/slack endpoints
│   ├── config/
│   │   ├── index.ts            # Environment config
│   │   ├── redis.ts            # Redis client setup
│   │   └── bullBoard.ts        # BullMQ dashboard
│   ├── db/
│   │   ├── index.ts            # Drizzle client
│   │   └── schema/
│   │       ├── accounts.ts
│   │       ├── brands.ts
│   │       ├── targets.ts
│   │       ├── runs.ts
│   │       ├── findings.ts
│   │       ├── artifacts.ts
│   │       ├── verifications.ts
│   │       ├── rulesets.ts
│   │       └── index.ts
│   ├── scripts/
│   │   └── testQueue.ts        # Queue testing utility
│   ├── services/
│   │   ├── browserService.ts   # Playwright wrapper
│   │   ├── findingService.ts   # Finding CRUD operations
│   │   └── queueService.ts     # BullMQ queue management
│   ├── utils/
│   │   ├── helpers.ts          # Shared utilities
│   │   └── logger.ts           # Winston/Pino logger
│   └── workers/
│       └── scanWorker.ts       # Main scan worker
├── tests/
│   └── helpers.test.ts
├── drizzle.config.ts           # Drizzle ORM config
├── jest.config.js              # Jest test config
├── package.json
├── pnpm-lock.yaml
├── README.md
├── server.cjs                  # Legacy server (deprecated)
└── tsconfig.json
```

### Planned Additions
```
src/
├── detectors/                  # NEW: Detector modules
│   ├── index.ts
│   ├── formSubmitBlocked.ts    # form.submit_blocked detector
│   ├── rateLimitDetector.ts    # (future)
│   └── captchaLoopDetector.ts  # (future)
├── workers/
│   ├── crawlerWorker.ts        # NEW: Crawler worker
│   ├── rendererWorker.ts       # NEW: Renderer worker
│   ├── detectorWorker.ts       # NEW: Detector worker
│   ├── verifierWorker.ts       # NEW: Verifier worker
│   └── alertWorker.ts          # NEW: Alert/Slack worker
└── services/
    ├── slackService.ts         # NEW: Slack API wrapper
    ├── storageService.ts       # NEW: S3/local storage
    ├── rulesService.ts         # NEW: Ruleset management
    └── metricsService.ts       # NEW: Prometheus metrics

ui/                             # NEW: Next.js frontend
├── app/
│   ├── page.tsx                # Dashboard home
│   ├── runs/[id]/page.tsx      # Run details
│   └── metrics/page.tsx        # Observability
├── components/
│   ├── FindingCard.tsx
│   ├── MetricsChart.tsx
│   └── CircuitBreakerStatus.tsx
└── package.json

artifacts/                      # NEW: Local artifact storage
├── screenshots/
├── har/
├── html/
└── logs/
```

---

## 12. Data Flow Example

### End-to-End Scenario: Form Submit Blocked

```
1. CRAWL
   └─► Crawler fetches target: { id: "t1", url: "example.com/signup", brandId: "b1" }
   └─► Checks rules: enabled=true, cooldown=24h, last_scan=48h_ago ✓
   └─► Enqueues: crawlQueue.add({ targetId: "t1", url: "..." })

2. RENDER
   └─► Renderer picks up job
   └─► Launches Playwright → navigates to example.com/signup
   └─► Fills form: name="John Doe", email="john@example.com"
   └─► Clicks submit → blocked by WAF (403 response)
   └─► Captures:
       • Screenshot: blocked_page.png
       • HAR: network_trace.har (shows 403 on POST /submit)
       • HTML: page_after_block.html
       • Console logs: ["Error: Request blocked by security policy"]
   └─► Saves artifacts → S3
   └─► Enqueues: renderQueue.add({ targetId: "t1", artifactIds: [...] })

3. DETECT
   └─► Detector loads artifacts
   └─► Runs form.submit_blocked logic:
       • Checks HAR for POST requests with 403/429 status
       • Scans console logs for "blocked" keywords
       • Analyzes HTML for error messages
   └─► Finding detected! Creates:
       {
         id: "f1",
         targetId: "t1",
         detectorType: "form.submit_blocked",
         severity: "high",
         evidence: { email: "john@example.com", statusCode: 403 }
       }
   └─► Enqueues: detectQueue.add({ findingId: "f1" })

4. VERIFY
   └─► Verifier extracts email from evidence
   └─► Calls mock CRM: POST /verify { email: "john@example.com" }
   └─► CRM responds: { isLegitimate: true, customerId: "c123" }
   └─► Records verification:
       {
         findingId: "f1",
         isLegitimate: true,
         latencyMs: 145
       }
   └─► Enqueues: verifyQueue.add({ findingId: "f1", verified: true })

5. ALERT
   └─► Alert worker formats Slack message
   └─► Looks up brand: { slackChannel: "#security-alerts" }
   └─► Sends Block Kit message with:
       • Header: "🚨 Form Submission Blocked"
       • Details: URL, email, evidence links
       • Button: "Re-verify"
   └─► Records alert sent in DB
   └─► Sets cooldown: redis.setex("cooldown:b1:form.submit_blocked", 86400, ...)

6. RE-VERIFY (User Action)
   └─► User clicks "Re-verify" in Slack
   └─► Slack → POST /api/slack/actions
   └─► API checks idempotency + rate limit
   └─► Enqueues: verifyQueue.add({ findingId: "f1", reason: "manual_reverify" })
   └─► Verifier re-runs CRM check
   └─► Posts result to Slack thread: "✅ Still verified as legitimate user"
```

---

## 13. Security Considerations

### API Security
- **Authentication**: API keys for external services (Slack, S3)
- **Rate Limiting**: Per-IP and per-endpoint limits (express-rate-limit)
- **Input Validation**: All user inputs sanitized (express-validator)
- **HTTPS Only**: TLS 1.2+ required in production

### Data Protection
- **PII Handling**: Emails, user IDs encrypted at rest (future)
- **Artifact Access**: Pre-signed S3 URLs with 1-hour expiry
- **Secrets Management**: Environment variables via `.env` (dotenv)
- **SQL Injection**: Drizzle ORM parameterized queries

### Browser Security
- **Sandbox**: Playwright runs in isolated contexts
- **User Agent**: Randomized to avoid fingerprinting
- **Proxy**: Optional proxy support for anonymity
- **Resource Limits**: Memory/CPU caps per browser instance

---

## 14. Next Steps

### Short-Term (Remaining PoC Days)
1. ✅ Implement `form.submit_blocked` detector
2. ✅ Complete verification pipeline
3. ✅ Integrate Slack alerts with re-verify action
4. ✅ Pass Gate #3 (E2E Detector)
5. ✅ Run 50-URL smoke test

### Medium-Term (Post-PoC)
1. Deploy to staging environment
2. Add 2 more detectors (rate_limit, captcha_loop)
3. Build metrics dashboard (Next.js + Recharts)
4. Implement circuit breaker logic
5. S3 artifact storage

### Long-Term (Production)
1. Multi-tenant support (separate DBs per account)
2. Advanced ruleset UI (enable/disable detectors per brand)
3. Historical trend analysis (finding frequency over time)
4. Auto-remediation (suggest WAF rule changes)
5. Kubernetes deployment with auto-scaling

---

## 15. References

- **BullMQ Docs**: https://docs.bullmq.io
- **Playwright Docs**: https://playwright.dev
- **Drizzle ORM**: https://orm.drizzle.team
- **Slack Block Kit**: https://api.slack.com/block-kit
- **Prometheus Metrics**: https://prometheus.io/docs/concepts/metric_types

---

**Document Maintained By**: Unleak Engineering Team  
**Last Updated**: October 16, 2025  
**Version**: 1.0
