# Unleak PoC

**Day 1 Implementation:** Database schema (ERD), Postgres migrations, Fetcher interface with Direct HTTP adapter, and database-connected API endpoints.

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

```bash
npm run dev
```

The server will start on `http://localhost:8000` (or the port specified in your `.env` file).

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
SLACK_WEBHOOK_URL=         # For alerts (not yet wired)

# Circuit Breaker
BREAKER_OPEN_MINUTES=20
BREAKER_ERROR_RATE_THRESHOLD_PCT=50

# Reverify Configuration
REVERIFY_TTL_SECONDS=120
REVERIFY_RATE_PER_FINDING_PER_HOUR=5
```

---

## Available Scripts

```bash
# Development
npm run dev              # Start development server with auto-reload

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

# Code Quality
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint errors
npm run format           # Format code with Prettier
npm run format:check     # Check code formatting
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

