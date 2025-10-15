# Unleak PoC

**Day-0 baseline**: minimal server + sandbox endpoints + API stubs.

## Quick start (Windows, PowerShell)

powershell
npm run dev         # starts server on :3000
npm run "smoke:win" # runs /ok, /fail, /slow + /api/runs

# Endpoints
/ok, /fail, /slow, /verify
POST /api/runs → { id, submitted, count }
GET /api/runs/:id
POST /api/findings/:id/reverify (Idempotency-Key, TTL 120s)
POST /api/slack/actions


