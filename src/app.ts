import express from "express";
import { defaultAdapters } from "./adapters.js";
import { AgentHub } from "./agent.js";
import { Cache, PgMirror, Watcher } from "./store.js";
import { extractInvoice } from "./extractor.js";
import { TYPES, type ResourceType } from "./types.js";

export function createApp(adapters = defaultAdapters()) {
  const app = express(); app.use(express.json({ limit: "1mb" }));
  const cache = new Cache(); const watcher = new Watcher(adapters); const mirror = new PgMirror();
  const hub = new AgentHub(); const failed: any[] = [];
  const byId = (id?: string) => adapters.find(a => !id || a.id === id) ? adapters.filter(a => !id || a.id === id) : [];

  app.get("/health", (_q, r) => r.json({ ok: true, agentConnected: hub.connected, cache: cache.stats(), sources: adapters.map(a => ({ id: a.id, label: a.label })) }));

  for (const type of TYPES) {
    app.get(`/v1/${type}`, async (req, res) => {
      try {
        const q = { source: req.query.source as string, status: req.query.status as string, projectId: req.query.projectId as string, q: req.query.q as string, since: req.query.since as string, cursor: req.query.cursor as string, limit: Number(req.query.limit) || 50 };
        const parts = await Promise.all(byId(q.source).map(a => a.all(type)));
        const all = parts.flat();
        // reuse cursor pagination over the merged, id-sorted set
        const { paginate } = await import("./types.js");
        res.json(paginate(all, q));
      } catch (e: any) { failed.push({ type, error: e.message, at: new Date().toISOString() }); res.status(502).json({ error: e.message }); }
    });
    app.get(`/v1/${type}/:id`, async (req, res) => {
      const [source, , externalId] = req.params.id.includes(":") ? req.params.id.split(/:(.*)/s) && [req.params.id.split(":")[0], "", req.params.id.split(":").slice(2).join(":")] : ["", "", req.params.id];
      for (const a of byId(source || undefined)) { const r = await a.get(type as ResourceType, externalId); if (r) return res.json(r); }
      res.status(404).json({ error: "not found" });
    });
  }

  app.get("/v1/analytics/cost-summary", async (req, res) => {
    const key = `cost-summary:${req.query.projectId || "all"}`;
    const hit = await cache.get(key); if (hit) return res.json({ ...hit, cached: true });
    const codes = (await Promise.all(adapters.map(a => a.all("cost-codes")))).flat().filter(r => !req.query.projectId || r.projectId === req.query.projectId);
    const out = { projectId: req.query.projectId || "all", costCodes: codes.length, actualCents: codes.reduce((s, r) => s + (r.amountCents || 0), 0), budgetCents: codes.reduce((s, r) => s + Number(r.data.budgetCents || 0), 0), bySource: Object.fromEntries(adapters.map(a => [a.id, codes.filter(r => r.source === a.id).length])), cached: false };
    await cache.set(key, out, 60); res.json(out);
  });
  app.get("/v1/analytics/cache-stats", (_q, r) => r.json(cache.stats()));

  app.post("/v1/sync", async (_q, res) => {
    const events = await watcher.pollOnce();
    for (const e of events) if (e.record) await mirror.upsert(e.record);
    res.json({ changed: events.length, at: new Date().toISOString() });
  });
  app.get("/v1/events", (_q, r) => r.json({ items: watcher.events.slice(-200) }));
  app.post("/v1/webhooks", (req, res) => { if (!req.body?.url) return res.status(400).json({ error: "url required" }); watcher.subscribers.push(req.body.url); res.status(201).json({ subscribed: req.body.url }); });

  app.get("/v1/agent/status", (_q, r) => r.json({ connected: hub.connected }));
  app.post("/v1/agent/query", async (req, res) => { try { res.json({ rows: await hub.query(String(req.body?.sql || "")) }); } catch (e: any) { res.status(503).json({ error: e.message }); } });

  app.post("/v1/extract/invoice", async (req, res) => {
    if (!req.body?.text) return res.status(400).json({ error: "text required" });
    try { res.json(await extractInvoice(String(req.body.text))); } catch (e: any) { res.status(502).json({ error: e.message }); }
  });

  app.get("/v1/sync/status", async (_q, res) => {
    const accounts = [];
    for (const a of adapters) { let count = 0, error: string | null = null; try { for (const t of TYPES) count += (await a.all(t)).length; } catch (e: any) { error = e.message; } accounts.push({ id: a.id, label: a.label, status: error ? "error" : "connected", records: count, lastError: error }); }
    res.json({ accounts, failed, events: watcher.events.length, agentConnected: hub.connected });
  });
  return { app, hub, cache, watcher };
}
