# Unleak PoC

**Implementation Status:**
- ✅ **Day 1:** Database schema (ERD), Postgres migrations, Fetcher interface, API endpoints
- ✅ **Day 2:** Queue system (BullMQ), workers (scan, render), job orchestration
- ✅ **Day 3:** Circuit breaker, Slack alerts, Re-verify with TTL/rate limiting
- ✅ **Day 4:** Rules engine, fingerprinting, deduplication, cooldowns, maintenance windows, robots.txt, allow-list

For detailed Day-4 documentation, see [DAY4_IMPLEMENTATION.md](./DAY4_IMPLEMENTATION.md).

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
# or
pnpm install
```

### 2. Create PostgreSQL Database

Create a new database in PostgreSQL:

```sql
CREATE DATABASE unleak_poc;
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and update the database credentials:

```bash
cp .env.example .env
```

Edit `.env` and set your PostgreSQL connection details:

```bash
# PostgreSQL Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=unleak_poc
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_SSL=false
```

### 4. Run Database Migrations

Apply the database schema migrations:

```bash
npm run db:migrate
```

This will create all required tables: `runs`, `findings`, `breaker_states`, `reverify_keys`, and `reverify_counters`.

### 5. Start Redis with Docker

Run Redis in a Docker container:

```bash
# Pull and run Redis
docker run -d --name redis-unleak -p 6379:6379 redis:latest

# Verify Redis is running
docker ps
```

For more details on running Redis with Docker, see: [Redis Docker Official Image](https://hub.docker.com/_/redis)

### 6. Start Development Server

**Option 1: All-in-One (Recommended)**

Start the API server and both workers together:

```bash
npm run dev
# or
pnpm dev
```

This will start:
- 🔵 **API Server** on `http://localhost:8000`
- 🟢 **Scan Worker** - Processes URL scanning jobs
- 🟡 **Render Worker** - Captures screenshots and evidence with Playwright

**Option 2: Start Services Individually**

If you need to run services separately (useful for debugging):

```bash
# Terminal 1 - API Server only
npm run dev:api

# Terminal 2 - Scan Worker only
npm run dev:scan

# Terminal 3 - Render Worker only
npm run dev:render
```

**Option 3: Workers Only**

Run both workers without the API server:

```bash
npm run worker:all
```

> **Note**: The render worker requires Playwright browsers. These are automatically installed during `npm install` via the postinstall script. If you encounter browser-related errors, run: `npx playwright install chromium`

---

## Verify Installation

Test that everything is working:

```bash
# Test the fetcher (Direct HTTP adapter)
npm run test:fetcher

# Test the API endpoints (requires server running)
npm run test:runs-api
```

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

