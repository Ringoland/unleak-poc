# Unleak PoC

**Implementation Status:**
- ✅ **Day 1:** Database schema (ERD), Postgres migrations, Fetcher interface, API endpoints
- ✅ **Day 2:** Queue system (BullMQ), workers (scan, render), job orchestration
- ✅ **Day 3:** Circuit breaker, Slack alerts, Re-verify with TTL/rate limiting
- ✅ **Day 4:** Rules engine, fingerprinting, deduplication, cooldowns, maintenance windows, robots.txt, allow-list
- ✅ **Day 5:** Prometheus metrics, HTML admin panels, stability testing, repo hygiene

For detailed Day-4 documentation, see [DAY4_IMPLEMENTATION.md](./DAY4_IMPLEMENTATION.md).

---

## Quick Start

### Prerequisites

Before starting, ensure you have:

**Required:**
- **Node.js** v18+ ([Download](https://nodejs.org/))
- **pnpm** v8+ (faster, more efficient than npm)
- **PostgreSQL** v14+ (local or Docker)
- **Redis** (local or Docker)

**Install pnpm:**
```bash
# macOS/Linux
npm install -g pnpm

# Or via curl
curl -fsSL https://get.pnpm.io/install.sh | sh -

# Windows (PowerShell)
iwr https://get.pnpm.io/install.ps1 -useb | iex
```

**Why pnpm?**
- ⚡ 2-3x faster than npm
- 💾 Saves disk space with content-addressable storage
- 🔒 Strict dependency resolution (no phantom dependencies)

### 1. Install Dependencies

```bash
# Install Node packages + Playwright browsers (automatic)
pnpm install

# If postinstall fails, install Playwright manually:
pnpm install
npx playwright install chromium

# Verify Playwright installation
npx playwright --version
```

**Playwright Notes:**
- Chromium browser (~300MB) downloads during `pnpm install`
- **Windows:** May require [Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)
- **macOS:** May require Rosetta 2 on Apple Silicon: `softwareupdate --install-rosetta`
- **Linux:** May need system dependencies:
  ```bash
  # Ubuntu/Debian
  npx playwright install-deps chromium
  ```

### 2. Setup PostgreSQL

**macOS (Homebrew):**
```bash
# Install PostgreSQL
brew install postgresql@14
brew services start postgresql@14

# Create database
createdb unleak_poc

# Or using psql:
psql postgres -c "CREATE DATABASE unleak_poc;"
```

**Windows:**
```powershell
# Download installer from: https://www.postgresql.org/download/windows/
# After installation, open pgAdmin or psql and run:
CREATE DATABASE unleak_poc;
```

**Docker (Cross-platform):**
```bash
# Run PostgreSQL in Docker
docker run -d \
  --name postgres-unleak \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=unleak_poc \
  -p 5432:5432 \
  postgres:14

# Verify it's running
docker ps
```

### 3. Setup Redis

**macOS (Homebrew):**
```bash
brew install redis
brew services start redis
```

**Windows (Docker):**
```powershell
docker run -d --name redis-unleak -p 6379:6379 redis:latest
```

**Linux/macOS (Docker):**
```bash
docker run -d --name redis-unleak -p 6379:6379 redis:latest

# Verify Redis is running
docker ps
redis-cli ping  # Should return PONG
```

### 4. Configure Environment

```bash
# Copy example config
cp .env.example .env

# Edit .env with your settings
# Required: Update DB_PASSWORD if using non-default PostgreSQL setup
```

**Key environment variables:**
```bash
# Database (Required)
DB_PASSWORD=postgres          # Your PostgreSQL password

# Circuit Breaker (Recommended)
BREAKER_ENABLED=true          # Enable failure protection

# Slack (Optional)
SLACK_WEBHOOK_URL=            # Add for alert notifications
```

See `.env.example` for all available configuration options.

### 5. Run Database Migrations

```bash
# Apply schema migrations
pnpm db:push

# Or use Drizzle Kit migrate:
pnpm db:migrate
```

This creates tables: `runs`, `findings`, `artifacts`

### 6. Start the Application

**Option 1: All-in-One (Recommended)**
```bash
pnpm dev
```

Starts:
- 🔵 **API Server** on `http://localhost:8000`
- 🟢 **Scan Worker** - Processes URL scanning
- 🟡 **Render Worker** - Captures evidence with Playwright

**Option 2: Individual Services** (for debugging)
```bash
# Terminal 1 - API only
pnpm dev:api

# Terminal 2 - Scan worker only
pnpm dev:scan

# Terminal 3 - Render worker only
pnpm dev:render
```

**Option 3: Production Build**
```bash
pnpm build
pnpm start

# Start workers separately:
pnpm worker:scan
pnpm worker:render
```

---

## Verify Installation

**Test the API:**
```bash
# Health check
curl http://localhost:8000/health

# Expected: {"status":"ok","timestamp":"..."}
```

**Create a test run:**
```bash
curl -X POST http://localhost:8000/api/runs \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://example.com"]}'

# Expected: {"runId":"...","status":"queued","urls":1}
```

**View queue dashboard:**
```
# Enable admin routes first
ADMIN_ENABLED=true

# Then access:
Open: http://localhost:8000/admin/queues
Login: admin / admin (change in .env)
```

**View Prometheus metrics:**
```
Open: http://localhost:8000/metrics
```

---

## Docker Quickstart (All-in-One)

Coming soon: `docker-compose.yml` with PostgreSQL, Redis, and Unleak PoC.

For now, run dependencies with Docker:

**docker-compose.yml:**
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:14
    environment:
      POSTGRES_DB: unleak_poc
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data

  redis:
    image: redis:latest
    ports:
      - "6379:6379"

volumes:
  postgres-data:
```

**Start dependencies:**
```bash
docker-compose up -d
```

Then run the app locally:
```bash
pnpm install
pnpm db:push
pnpm dev
```

---

## Troubleshooting

### Issue: Playwright browsers not installed
**Solution:**
```bash
npx playwright install chromium
```

### Issue: PostgreSQL connection failed
**Solution:**
```bash
# Check if PostgreSQL is running
# macOS:
brew services list

# Windows/Docker:
docker ps

# Test connection
psql -h localhost -U postgres -d unleak_poc
```

### Issue: Redis connection failed
**Solution:**
```bash
# Test Redis connection
redis-cli ping

# If using Docker, check container:
docker ps
docker logs redis-unleak
```

### Issue: Port 8000 already in use
**Solution:**
```bash
# Change port in .env
PORT=8000

# Or kill existing process:
# macOS/Linux:
lsof -ti:8000 | xargs kill -9

# Windows:
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

### Issue: Database migrations fail
**Solution:**
```bash
# Drop and recreate database
dropdb unleak_poc
createdb unleak_poc

# Re-run migrations
pnpm db:push
```

### Issue: Queue jobs stuck
**Solution:**
```bash
# View queue dashboard
Open: http://localhost:8000/admin/queues

# Clean stuck jobs
redis-cli FLUSHDB  # WARNING: Clears all Redis data

# Or use the clean queue script:
ts-node src/scripts/cleanQueue.ts
```

For more help, see individual test files in `tests/` directory or check logs in `artifacts/logs/`.

---

## API Endpoints

### Runs

**POST /api/runs** - Create a new scan run

Request:
```json
{
  "urls": ["https://example.com", "https://example.org"],
  "payload": { "description": "Optional metadata" }
}
```

Response:
```json
{
  "id": "uuid",
  "submitted": "2025-10-16T10:30:00Z",
  "count": 2
}
```

**GET /api/runs/:id** - Get run details

Response:
```json
{
  "id": "uuid",
  "status": "queued",
  "runType": "manual",
  "urlCount": 2,
  "findingCount": 0,
  "submittedAt": "2025-10-16T10:30:00Z",
  "startedAt": null,
  "completedAt": null,
  "payload": { ... },
  "error": null,
  "createdAt": "2025-10-16T10:30:00Z",
  "updatedAt": "2025-10-16T10:30:00Z"
}
```

### Findings

**POST /api/findings/:id/reverify** - Re-verify a finding

Requires `Idempotency-Key` header (TTL: 120s)

Response:
```json
{
  "id": "uuid",
  "reverifyStatus": "accepted" | "duplicate_ttl" | "rate_limited"
}
```

### Slack

**POST /api/slack/actions** - Handle Slack button interactions (stub)

---

## Database Schema

The application uses PostgreSQL with the following main tables:

- **runs** - Scan execution runs (UUID primary key, status='queued' by default)
- **findings** - Detected issues from scans (indexed on fingerprint and run_id)
- **breaker_states** - Circuit breaker state tracking for external services
- **reverify_keys** - Idempotency key tracking for re-verification requests
- **reverify_counters** - Rate limiting counters for reverify requests

### View Database Schema

```bash
# Open Drizzle Studio to explore the database
npm run db:studio
```

---

## Fetcher Service

The application includes a production-ready HTTP fetcher with retry/backoff logic:

### Direct HTTP Adapter

```typescript
import { createFetcher } from './services/fetcher';

const fetcher = createFetcher({ adapter: 'direct' });

const result = await fetcher.fetch('https://example.com', {
  timeoutMs: 5000,
  headers: { 'User-Agent': 'Unleak/1.0' },
  retries: 3
});

console.log(result);
// { status: 200, body: '...', latencyMs: 450, success: true }
```

### Features

- **Exponential backoff**: 1s → 2s → 4s with jitter
- **Max delay cap**: 20 seconds
- **Retryable errors**: Timeouts, network errors, 5xx status codes
- **ZenRows support**: Stub adapter ready for proxy/anti-bot services

---

## Configuration

### Environment Variables

Key configuration options in `.env`:

```bash
# Application
NODE_ENV=development
PORT=8000

# PostgreSQL Database
DATABASE_URL=postgresql://user:password@localhost:5432/unleak_poc
DB_HOST=localhost
DB_PORT=5432
DB_NAME=unleak_poc
DB_USER=postgres
DB_PASSWORD=postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Fetcher
ZENROWS_API_KEY=          # Optional: ZenRows API key
FETCHER_ADAPTER=direct     # 'direct' or 'zenrows'
FETCHER_TIMEOUT_MS=30000
FETCHER_RETRIES=3

# External Services
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Circuit Breaker (Day-3)
BREAKER_ENABLED=false      # Set to 'true' to enable circuit breaker
BREAKER_OPEN_MINUTES=20    # Duration circuit stays open (minutes)
BREAKER_ERROR_RATE_THRESHOLD_PCT=50   # Error rate % to trigger open
BREAKER_ERROR_RATE_WINDOW=10          # Window size for error rate calculation

# Reverify Configuration (Day-3)
REVERIFY_TTL_SECONDS=120                  # Idempotency key TTL
REVERIFY_RATE_PER_FINDING_PER_HOUR=5      # Max reverify requests per finding per hour

# Base URL (for Slack action buttons)
BASE_URL=http://localhost:8000
```

---

## Day-3: Circuit Breaker & Actionable Alerts

### Circuit Breaker

The application includes a per-host circuit breaker to prevent cascading failures.

**Enable Circuit Breaker:**
```bash
# In .env file
BREAKER_ENABLED=true
```

**How It Works:**
- **Closed** → Normal operation, requests pass through
- **Open** → Circuit opens after ≥3 consecutive failures OR ≥50% of last 10 requests fail
  - Requests blocked for 20 minutes
- **Half-Open** → After 20 minutes, allows ONE probe request
  - Success → closes circuit
  - Failure → reopens for 40 minutes (exponential backoff)

**Monitor Breaker States:**
```bash
curl http://localhost:8000/api/admin/breaker
```

Response:
```json
{
  "timestamp": "2025-10-21T10:30:00Z",
  "breakerCount": 2,
  "breakers": [
    {
      "targetId": "httpbin.org",
      "state": "open",
      "failureCount": 5,
      "successCount": 3,
      "failureRate": 0.625,
      "openedAt": "2025-10-21T10:15:00Z",
      "nextProbeAt": "2025-10-21T10:35:00Z",
      "recentOutcomes": [
        { "outcome": "failure", "timestamp": "2025-10-21T10:14:58Z" },
        { "outcome": "failure", "timestamp": "2025-10-21T10:14:57Z" }
      ]
    }
  ]
}
```

**Reset a Breaker (Admin):**
```bash
curl -X POST http://localhost:8000/api/admin/breaker/reset \
  -H "Content-Type: application/json" \
  -d '{"targetId": "httpbin.org"}'
```

### Slack Alerts

Automated alerts are sent to Slack when:
- **5xx errors** occur
- **High latency** detected (>1500ms)
- **Timeouts** or **network errors**

**Setup:**
```bash
# Get a Slack webhook URL from: https://api.slack.com/messaging/webhooks
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

**Alert Actions:**
Each alert includes three action buttons:
1. **✅ Ack** - Acknowledge the alert (tracked for 24 hours)
2. **🔇 Mute** - Mute alerts for this finding (1 hour)
3. **🔄 Re-verify** - Trigger re-verification

**Check Alert Status:**
```bash
curl "http://localhost:8000/api/slack/actions/status?findingId=test-123"
```

### Re-verify Endpoints

Re-verify a finding with TTL and rate limiting enforced.

**Required Header:**
```
Idempotency-Key: unique-key-123
```

**TTL Protection (120 seconds):**
```bash
# First request (accepted)
curl -X POST http://localhost:8000/api/findings/abc-123/reverify \
  -H "Idempotency-Key: key-001"

# Response: { "id": "abc-123", "reverifyStatus": "accepted" }

# Second request within 120s (duplicate)
curl -X POST http://localhost:8000/api/findings/abc-123/reverify \
  -H "Idempotency-Key: key-001"

# Response: { "id": "abc-123", "reverifyStatus": "duplicate_ttl" }
```

**Rate Limiting (5 requests/hour per finding):**
```bash
# 6th request within 1 hour (rate limited)
curl -X POST http://localhost:8000/api/findings/abc-123/reverify \
  -H "Idempotency-Key: key-006"

# Response (429): { "id": "abc-123", "reverifyStatus": "rate_limited" }
```

### Observability

**Prometheus Metrics:**
```bash
curl http://localhost:8000/metrics
```

**Available Metrics:**
- `unleak_runs_created_total` - Total runs created
- `unleak_http_response_status_total` - HTTP status code counts
- `unleak_http_request_duration_ms` - Request latency histogram
- `unleak_breaker_state_changes_total` - Circuit breaker state transitions
- `unleak_breaker_requests_blocked_total` - Requests blocked by breaker
- `unleak_slack_alerts_sent_total` - Slack alerts sent
- `unleak_reverify_requests_total` - Re-verify request counts
- `unleak_active_runs` - Current active runs (gauge)
- `unleak_breaker_state` - Breaker states (0=closed, 1=half_open, 2=open)

### Testing Circuit Breaker

**Trigger Failures:**
```bash
# Test 5xx errors
curl -X POST http://localhost:8000/api/runs \
  -H "Content-Type: application/json" \
  -d '{"urls": ["http://httpbin.org/status/500"]}'

# Test high latency
curl -X POST http://localhost:8000/api/runs \
  -H "Content-Type: application/json" \
  -d '{"urls": ["http://httpbin.org/delay/3"]}'
```

**Verify Breaker Opens:**
```bash
# Check breaker state
curl http://localhost:8000/api/admin/breaker

# Try another request (should be blocked)
curl -X POST http://localhost:8000/api/runs \
  -H "Content-Type: application/json" \
  -d '{"urls": ["http://httpbin.org/status/500"]}'
```

### Testing Slack Alerts

**Quick Test:**
```bash
npm run test:slack
```

This will trigger 4 types of alerts:
1. 5xx server error
2. High latency (>1500ms)
3. Request timeout
4. Network error

**Expected Output:**
```
[INFO] [Slack] Alert sent successfully { findingId: 'xxx', errorType: '5xx', ... }
[INFO] [Slack] Alert sent successfully { findingId: 'yyy', errorType: 'latency', ... }
[INFO] [Slack] Alert sent successfully { findingId: 'zzz', errorType: 'timeout', ... }
[INFO] [Slack] Alert sent successfully { findingId: 'aaa', errorType: 'network', ... }
```

**Troubleshooting:**
- If no alerts are sent, see [SLACK_ALERTS_TROUBLESHOOTING.md](./SLACK_ALERTS_TROUBLESHOOTING.md)
- Ensure `BREAKER_ENABLED=true` and `SLACK_WEBHOOK_URL` is set in `.env`
- Alerts only work when fetcher is used with `targetId` parameter

---

## Day-5: Stability Testing

### Running the 50-URL Stability Exercise

The stability test validates all Day-3 and Day-4 features working together with a comprehensive test suite of 50 URLs:
- **30 OK URLs** - Return 200 status (httpstat.us, example.com, httpbin.org)
- **10 FAIL URLs** - Return 5xx errors (500, 502, 503, 504)
- **10 SLOW URLs** - Delayed responses (3-5 seconds)

**Prerequisites:**
1. Start the API server and workers:
   ```bash
   pnpm dev
   ```

2. Ensure PostgreSQL and Redis are running

**Run the Test:**
```bash
pnpm stability
```

**What Gets Tested:**
- ✅ **Retries** - Automatic retry logic for failed requests
- ✅ **Circuit Breaker** - Trips on repeated failures, allows probe requests
- ✅ **Rules Engine** - Matches URLs against configured rules
- ✅ **Cooldowns** - Suppresses duplicate findings within cooldown period
- ✅ **Maintenance Windows** - Respects scheduled maintenance periods
- ✅ **robots.txt** - Validates URLs against robots.txt policies
- ✅ **Allow-List** - Only processes allowed domains

**Example Output:**
```
================================================================================
📊 STABILITY TEST REPORT
================================================================================

🆔 Run ID: 123e4567-e89b-12d3-a456-426614174000
⏱️  Duration: 45.23s
📅 Timestamp: 2025-10-23T10:30:00.000Z

📋 SUMMARY
   Total URLs: 50
   ✅ OK (200): 30 (60%)
   ❌ FAIL (5xx): 10 (20%)
   🐌 SLOW (delay): 10 (20%)

🔍 FINDINGS
   Total: 50
   By Status:
      evidence_captured: 42 (84%)
      suppressed: 5 (10%)
      failed: 3 (6%)
   With Evidence: 42

🚫 SUPPRESSED
   Total: 5
   By Reason:
      Cooldown/Duplicate: 3
      Maintenance Window: 1
      robots.txt: 1
      Allow-list: 0

⚡ LATENCY
   Average: 1250ms
   P50: 800ms
   P95: 3200ms
   P99: 4800ms
   Min: 120ms
   Max: 5100ms

🔌 CIRCUIT BREAKER
   Trips Observed: 2
   Hosts Affected: httpstat.us, httpbin.org

================================================================================
✅ Report Complete
================================================================================
```

**Report Location:**
The detailed JSON report is saved to `reports/stability-report-{timestamp}.json`

**View Results:**
After the test completes, view the run in your browser:
```bash
# Get the run ID from the test output, then:
open http://localhost:8000/admin/runs/{runId}
```

---

## Day-6: Stripe Lite (Non-Transactional) + Polish

### Stripe Lite Integration

Stripe Lite provides mock payment flows for testing without creating real charges or customers. **Safe by default** - all routes no-op unless explicitly enabled.

**⚠️ Important: NO REAL BILLING** - This is mock/audit-only. Real billing comes after PoC.

**Configuration:**
```bash
# In .env file (source of truth)
STRIPE_LITE_ENABLED=false           # Set to 'true' to enable (default: false)
STRIPE_API_KEY=                     # Optional: sk_test_... for webhook validation
STRIPE_WEBHOOK_SECRET=              # Optional: whsec_... from Stripe Dashboard
```

**Three Endpoints:**

1. `GET /api/stripe/health` - Check status
2. `POST /api/stripe/mock-intent` - Create mock payment intent (NO REAL CHARGE)
3. `POST /api/stripe/webhook` - Receive webhooks (NO SIDE EFFECTS)

---

#### 1. Health Check

Check if Stripe Lite is enabled and configured:

```bash
curl http://localhost:8000/api/stripe/health
```

**Response:**
```json
{
  "enabled": true,        // STRIPE_LITE_ENABLED status
  "keyPresent": true      // Whether STRIPE_API_KEY is set
}
```

---

#### 2. Mock Payment Intent

Creates a mock payment intent (**NO REAL STRIPE API CALL**). Just synthesizes an ID and writes a redacted audit row.

**Requirements:**
- `STRIPE_LITE_ENABLED=true`

```bash
curl -X POST http://localhost:8000/api/stripe/mock-intent \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "plan": "pro"
  }'
```

**Response:**
```json
{
  "ok": true,
  "id": "pi_mock_a1b2c3d4e5f6",
  "plan": "pro",
  "email": "user@example.com"
}
```

**What happens:**
- ✅ Generates fake payment intent ID
- ✅ Writes redacted audit row to `stripe_events` table
- ❌ **NO** real Stripe API calls
- ❌ **NO** customers/charges/subscriptions created

**Audit Log:**
```sql
SELECT * FROM stripe_events ORDER BY created_at DESC LIMIT 1;
```

```
event_type: mock_intent
payment_id: pi_mock_a1b2c3d4e5f6
plan: pro
payload: {"email": "***@example.com", "plan": "pro"}  ← PII redacted
```

**Clean Logs:**
```
stripe.mock_intent ok plan=pro
```
No emails, no keys, just the plan.

---

#### 3. Webhook Handler

Receives Stripe webhook events. **NO SIDE EFFECTS** - just acknowledges (200) and exits.

**Signature Verification:**
- Only validates if `STRIPE_WEBHOOK_SECRET` is set
- Always returns `200 {received:true}` regardless of validation result

```bash
curl -X POST http://localhost:8000/api/stripe/webhook \
  -H "Content-Type: application/json" \
  -H "stripe-signature: t=123,v1=sig..." \
  -d '{
    "id": "evt_123",
    "type": "payment_intent.succeeded",
    "data": {
      "object": {"id": "pi_123", "amount": 1000}
    }
  }'
```

**Response (always 200):**
```json
{
  "received": true
}
```

**What happens:**
- ✅ Verifies signature (if `STRIPE_WEBHOOK_SECRET` set)
- ✅ Writes redacted audit row
- ✅ Always returns 200 to prevent retries
- ❌ **NO** state changes
- ❌ **NO** customer updates
- ❌ **NO** billing operations

**Clean Logs:**
```
stripe.webhook received type=payment_intent.succeeded verified=true
```

---

### Testing Stripe Locally

#### Option 1: Manual cURL (No Signature)

1. **Enable Stripe Lite:**
```bash
# In .env
STRIPE_LITE_ENABLED=true
```

2. **Start server:**
```bash
pnpm dev
```

3. **Test health:**
```bash
curl http://localhost:8000/api/stripe/health
```

4. **Create mock intent:**
```bash
curl -X POST http://localhost:8000/api/stripe/mock-intent \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","plan":"premium"}'
```

5. **Send webhook (no signature):**
```bash
curl -X POST http://localhost:8000/api/stripe/webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"payment_intent.succeeded","id":"evt_test"}'
```

---

#### Option 2: Stripe CLI (With Signature Verification)

**Install Stripe CLI:**
```bash
# macOS
brew install stripe/stripe-cli/stripe

# Windows
scoop install stripe

# Or download from: https://stripe.com/docs/stripe-cli
```

**Setup:**

1. **Login to Stripe:**
```bash
stripe login
```

2. **Forward webhooks to local server:**
```bash
stripe listen --forward-to http://localhost:8000/api/stripe/webhook
```

This outputs a webhook signing secret like:
```
Ready! Your webhook signing secret is whsec_xxxxx
```

3. **Add to .env:**
```bash
STRIPE_LITE_ENABLED=true
STRIPE_API_KEY=sk_test_your_key_here
STRIPE_WEBHOOK_SECRET=whsec_xxxxx  # From stripe listen
```

4. **Trigger test events:**
```bash
# Send a test webhook
stripe trigger payment_intent.succeeded

# Or custom events
stripe trigger invoice.paid
stripe trigger customer.created
```

5. **Verify in logs:**
```bash
# Check server logs for:
stripe.webhook received type=payment_intent.succeeded verified=true

# Check database:
psql unleak_poc -c "SELECT * FROM stripe_events ORDER BY created_at DESC LIMIT 5;"
```

---

### Security & Redaction

**Sensitive data is NEVER logged in clear text:**

- ✅ Emails redacted: `user@example.com` → `***@example.com`
- ✅ Stripe keys redacted: `sk_test_abc123` → `sk_***`
- ✅ Webhook secrets redacted: `whsec_abc123` → `whsec_***`
- ✅ Authorization headers redacted: `Bearer abc123` → `Bearer ***`

**Redaction helper:** `src/utils/redact.ts`

**Example logs:**
```
stripe.mock_intent ok plan=premium
stripe.webhook received type=invoice.paid verified=true
```

**No emails, no keys, no Authorization headers in logs.**

---

### Safety Features

- ✅ **Flag-gated:** `STRIPE_LITE_ENABLED=false` by default
- ✅ **NO real charges:** Mock IDs only
- ✅ **NO customer creation:** Audit logging only
- ✅ **NO subscriptions:** Test mode only
- ✅ **Webhook always returns 200:** Prevents retry storms
- ✅ **PII redaction:** Emails/keys never logged in clear
- ✅ **Signature verification:** Optional via `STRIPE_WEBHOOK_SECRET`

---

### Artifacts Structure

**New in Day-6:** Artifacts are organized with URL hashing for better organization:

```
artifacts/
├── <runId>/
│   ├── <findingId>/
│   │   ├── <url-hash>/          # NEW: 8-char MD5 hash of URL
│   │   │   ├── screenshot.png
│   │   │   ├── page.html
│   │   │   ├── trace.har
│   │   │   └── console.json
```

**Benefits:**
- Multiple findings from same run + URL don't collide
- Easier to find artifacts for specific URLs
- Backwards compatible with old flat structure

**API Response includes full paths:**
```bash
curl http://localhost:8000/api/admin/runs/{runId}
```

Response includes artifact paths:
```json
{
  "run": { "id": "...", "status": "completed" },
  "findings": [
    {
      "id": "finding-123",
      "url": "https://example.com",
      "artifacts": [
        {
          "id": "artifact-456",
          "type": "screenshot",
          "storageUrl": "runId/findingId/a1b2c3d4/screenshot.png",
          "fullPath": "artifacts/runId/findingId/a1b2c3d4/screenshot.png",
          "absolutePath": "/path/to/project/artifacts/runId/findingId/a1b2c3d4/screenshot.png"
        }
      ]
    }
  ]
}
```

### Tuning & Configuration

**New Configurable Thresholds:**

```bash
# In .env file

# robots.txt cache duration (seconds)
ROBOTS_CACHE_TTL_SECONDS=600  # Default: 10 minutes

# Latency threshold for slow request warnings (milliseconds)
LATENCY_MS_THRESHOLD=1500     # Default: 1.5 seconds
```

**Circuit Breaker Logging:**
Improved logging with concise single-line state transitions:

```
[Breaker] example.com: closed → open (5 failures, 20m window)
[Breaker] example.com: open (20m window until 2025-10-24T11:00:00Z)
[Breaker] example.com: open → half_open (probe)
[Breaker] example.com: half_open → closed (probe succeeded)
[Breaker] example.com: half_open → open (probe failed, extended cooldown)
```

---

## Day-4: Rules Engine & Smart Suppression

Day-4 adds intelligent finding management to reduce alert noise and improve operational efficiency.

### Key Features

🔍 **Fingerprinting**: SHA256-based finding identification with URL/error normalization  
🔁 **Deduplication**: Automatic tracking of duplicate findings with occurrence counts  
⏱️ **Cooldown Management**: Per-finding cooldown periods (default: 15 min)  
🛠️ **Maintenance Windows**: Suppress alerts during scheduled maintenance  
🤖 **Robots.txt Respect**: Honor robots.txt directives (cached 10 min)  
✅ **Allow-list**: Wildcard-based URL filtering before scanning  
📊 **Enhanced Metrics**: Suppression counters by reason, deduplication tracking  

### Quick Setup

1. **Create configuration files:**

```bash
# Rules configuration
cat > src/config/rules.json << EOF
{
  "defaults": {
    "cooldownSeconds": 900,
    "latencyMsThreshold": 1500,
    "respectRobots": true,
    "suppressDuringMaintenance": true
  },
  "rules": [
    {
      "id": "default-web",
      "pattern": ".*",
      "cooldownSeconds": 900,
      "latencyMsThreshold": 1500,
      "respectRobots": true
    }
  ]
}
EOF

# Allow-list (start empty to allow all)
touch src/config/allow-list.csv
```

2. **Add to `.env`:**

```bash
RULES_FILE=src/config/rules.json
ALLOW_LIST_FILE=src/config/allow-list.csv
```

3. **Restart server** - Rules engine loads automatically

### Admin Endpoints

```bash
# View rules engine status
curl http://localhost:8000/api/admin/rules | jq

# Get all fingerprints with details
curl http://localhost:8000/api/admin/rules/fingerprints | jq

# Reload allow-list without restart
curl -X POST http://localhost:8000/api/admin/rules/reload-allowlist

# Clear robots.txt cache
curl -X DELETE "http://localhost:8000/api/admin/rules/robots-cache?domain=example.com"
```

### New Metrics

```promql
# Findings suppressed by reason (cooldown, maintenance, robots, allowlist)
unleak_findings_suppressed_total{reason="..."}

# Fingerprint deduplication events (new vs updated)
unleak_fingerprint_deduplication_total{action="new|updated"}
```

### Documentation

📖 **Complete Day-4 Documentation**: [DAY4_IMPLEMENTATION.md](./DAY4_IMPLEMENTATION.md)  
✅ **Verification Checklist**: [DAY4_CHECKLIST.md](./DAY4_CHECKLIST.md)  

**Key Concepts:**

- **Fingerprinting**: URLs normalized (no query/fragments), errors normalized (no timestamps/IDs)
- **Deduplication**: First occurrence alerts, duplicates suppressed until cooldown expires
- **Allow-list**: Supports wildcards (`*.example.com`, `https://api.safe.com/*`)
- **Robots.txt**: Fetched per domain, cached 10 min, honors Disallow/Allow directives
- **Maintenance Windows**: UTC-based, multiple windows per rule supported

---

## Available Scripts

```bash
# Development - All Services
````

---

## Available Scripts

```bash
# Development - All Services
npm run dev              # Start API server + Scan worker + Render worker (recommended)

# Development - Individual Services
npm run dev:api          # Start API server only
npm run dev:scan         # Start scan worker only
npm run dev:render       # Start render worker only

# Workers (without auto-reload)
npm run worker:scan      # Start scan worker
npm run worker:render    # Start render worker
npm run worker:all       # Start both workers

# Building
npm run build            # Compile TypeScript to JavaScript
npm start               # Start production server

# Database
npm run db:generate      # Generate new migration from schema changes
npm run db:migrate       # Apply pending migrations
npm run db:push          # Push schema changes directly (dev only)
npm run db:studio        # Open Drizzle Studio GUI

# Testing
npm run test             # Run Jest tests
npm run test:watch       # Run Jest in watch mode
npm run test:fetcher     # Test Fetcher service
npm run test:runs-api    # Test API endpoints
npm run test:slack       # Test Slack alerts integration

# Code Quality
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint errors
npm run format           # Format code with Prettier
npm run format:check     # Check code formatting

# Setup
npm run setup            # Install dependencies + Playwright browsers
```

---

## Prometheus Metrics (Day-5)

The application exposes Prometheus metrics at `/metrics` endpoint.

### Available Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `unleak_runs_total` | Counter | Total scan runs by status | `status` |
| `unleak_fetch_latency_ms` | Histogram | Fetch latency in milliseconds | `targetUrl` |
| `unleak_status_code_total` | Counter | HTTP status codes encountered | `code` |
| `unleak_breaker_state_changes_total` | Counter | Circuit breaker state transitions | `targetId`, `fromState`, `toState` |
| `unleak_findings_created_total` | Counter | Total findings created | `severity`, `findingType` |
| `unleak_findings_suppressed_total` | Counter | Findings suppressed by rules engine | `reason` (cooldown/maintenance/robots/allowlist) |

### Scraping Locally

**Using curl:**
```bash
curl http://localhost:8000/metrics
```

**Using Prometheus (prometheus.yml):**
```yaml
scrape_configs:
  - job_name: 'unleak-poc'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:8000']
```

**Example output:**
```
# HELP unleak_runs_total Total number of scan runs by status
# TYPE unleak_runs_total counter
unleak_runs_total{status="completed"} 5
unleak_runs_total{status="in_progress"} 2

# HELP unleak_fetch_latency_ms Fetch latency in milliseconds
# TYPE unleak_fetch_latency_ms histogram
unleak_fetch_latency_ms_bucket{le="100",targetUrl="https://example.com"} 45
unleak_fetch_latency_ms_bucket{le="500",targetUrl="https://example.com"} 87
unleak_fetch_latency_ms_sum{targetUrl="https://example.com"} 12456.7
unleak_fetch_latency_ms_count{targetUrl="https://example.com"} 100

# HELP unleak_findings_suppressed_total Total number of findings suppressed by rules engine
# TYPE unleak_findings_suppressed_total counter
unleak_findings_suppressed_total{reason="cooldown"} 15
unleak_findings_suppressed_total{reason="maintenance"} 8
unleak_findings_suppressed_total{reason="robots"} 3
```

---

## Project Structure

```
unleak-poc/
├── src/
│   ├── api/              # Express routes and middleware
│   │   ├── routes/       # API endpoints
│   │   └── middleware/   # Error handling, auth
│   ├── db/               # Database layer
│   │   └── schema/       # Drizzle ORM table definitions
│   ├── services/         # Business logic services
│   │   └── fetcher/      # HTTP fetcher with retry/backoff
│   ├── workers/          # BullMQ background workers
│   ├── utils/            # Utilities (logger, helpers)
│   ├── config/           # Configuration management
│   └── scripts/          # Dev/test scripts
├── drizzle/              # Database migrations
├── config/               # Config files (allow-list.csv)
└── tests/                # Test files
```

---

