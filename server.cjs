const express = require("express");
const morgan = require("morgan");

const app = express();
app.use(express.json());
app.use(morgan("dev"));

// Sandbox endpoints
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.get("/ok", (_req, res) => res.status(200).json({ ok: true }));
app.get("/fail", (_req, res) => res.status(503).json({ ok: false, error: "synthetic_failure" }));
app.get("/slow", async (_req, res) => { await sleep(3000); res.status(200).json({ ok: true, slow: true }); });
app.post("/verify", (_req, res) => res.json({ verified: true }));

// API stubs for Day-0 contract
const runs = new Map();
app.post("/api/runs", (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
  const id = String(Date.now());
  const run = { id, submitted: Date.now(), count: urls.length, status: "done", urls, started: Date.now(), finished: Date.now() };
  runs.set(id, run);
  res.json({ id: run.id, submitted: run.submitted, count: run.count });
});
app.get("/api/runs/:id", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ error: "not_found" });
  res.json(run);
});

// Idempotent reverify (TTL 120s)
const reverifyTTLms = 120 * 1000;
const idempotency = new Map(); // key -> expiry
app.post("/api/findings/:id/reverify", (req, res) => {
  const key = req.header("Idempotency-Key");
  if (!key) return res.status(400).json({ error: "missing_idempotency_key" });
  const now = Date.now();
  const exp = idempotency.get(key);
  if (exp && exp > now) {
    return res.status(409).json({ error: "duplicate_ttl", ttlSecondsRemaining: Math.ceil((exp - now)/1000) });
  }
  idempotency.set(key, now + reverifyTTLms);
  res.json({ id: req.params.id, reverifyStatus: "accepted" });
});

// Slack actions stub
app.post("/api/slack/actions", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Unleak PoC listening on :${port}`));
