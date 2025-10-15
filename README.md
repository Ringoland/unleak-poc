# Unleak PoC

**Day-0 baseline:** minimal Node server + sandbox endpoints + API stubs.  
Goal: unblock the 10-day PoC so Builder can execute the Day-by-Day plan and hit the Gates.

---

## Quick start (Windows, PowerShell)

Powershell
npm run dev         # starts server on :3000
npm run "smoke:win" # runs /ok, /fail, /slow + /api/runs

Expected:
Terminal shows Unleak PoC listening on :3000
Smoke output shows ok ✓, fail ✓ (expected), slow ✓ (...), then a runId and JSON

## Endpoints

GET /ok – returns 200 { ok: true }

GET /fail – returns 503 { ok: false, error: "synthetic_failure" }

GET /slow – ~3s delay then 200

POST /verify – mock verify

POST /api/runs → { id, submitted, count }

GET /api/runs/:id → run status & payload

POST /api/findings/:id/reverify → Idempotency-Key required, TTL 120s

Returns { id, reverifyStatus: "accepted" | "duplicate_ttl" | "rate_limited" }

POST /api/slack/actions → { ok: true } (stub)


## **What’s in this repo now**

server.cjs — minimal CommonJS server (no TS/ESM friction)

scripts/smoke.ps1 — Windows smoke test for Day-0

.env.example, .gitignore

.github/workflows/ci.yml — CI stub

README.md — this file
