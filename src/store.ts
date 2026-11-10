import { createHash } from "node:crypto";
import type { Adapter, UnifiedRecord } from "./types.js";

/** TTL cache. Uses Redis when REDIS_URL is set (lazy ioredis), else in-process Map. */
export class Cache {
  hits = 0; misses = 0; private mem = new Map<string, { v: string; exp: number }>(); private redis: any;
  async init() {
    if (process.env.REDIS_URL && !this.redis) {
      try { const { default: Redis } = await import("ioredis"); this.redis = new (Redis as any)(process.env.REDIS_URL); this.redis.on("error", () => {}); }
      catch { /* ponytail: fall back to memory cache if redis driver/server unavailable */ }
    }
  }
  async get(k: string) {
    await this.init();
    const v = this.redis ? await this.redis.get(k).catch(() => null) : (this.mem.get(k)?.exp! > Date.now() ? this.mem.get(k)!.v : null);
    v == null ? this.misses++ : this.hits++; return v ? JSON.parse(v) : null;
  }
  async set(k: string, v: unknown, ttlSec = 60) {
    await this.init(); const s = JSON.stringify(v);
    if (this.redis) await this.redis.set(k, s, "EX", ttlSec).catch(() => {}); else this.mem.set(k, { v: s, exp: Date.now() + ttlSec * 1000 });
  }
  stats() { const t = this.hits + this.misses; return { hits: this.hits, misses: this.misses, hitRate: t ? +(this.hits / t).toFixed(4) : 0, backend: this.redis ? "redis" : "memory" }; }
}

/** Synthesized webhooks: sources have none, so poll + hash and emit on change. */
export interface SyncEvent { event: string; recordId: string; hash: string; at: string; record?: UnifiedRecord }
export class Watcher {
  hashes = new Map<string, string>(); events: SyncEvent[] = []; subscribers: string[] = [];
  constructor(private adapters: Adapter[]) {}
  async pollOnce(): Promise<SyncEvent[]> {
    const fresh: SyncEvent[] = [];
    for (const a of this.adapters) for (const t of ["vendors", "invoices", "commitments", "change-orders", "cost-codes"] as const) {
      for (const r of await a.all(t)) {
        const h = createHash("sha256").update(JSON.stringify(r)).digest("hex").slice(0, 16);
        const prev = this.hashes.get(r.id);
        if (prev !== h) {
          const ev: SyncEvent = { event: prev ? "record.updated" : "record.created", recordId: r.id, hash: h, at: new Date().toISOString(), record: r };
          this.hashes.set(r.id, h); this.events.push(ev); fresh.push(ev);
          for (const url of this.subscribers) fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ev) }).catch(() => {});
        }
      }
    }
    return fresh;
  }
  start(ms = 30_000) { const t = setInterval(() => this.pollOnce().catch(() => {}), ms); t.unref(); return () => clearInterval(t); }
}

/** Optional Postgres mirror; no-op without DATABASE_URL. */
export class PgMirror {
  pool: any;
  async init() {
    if (!process.env.DATABASE_URL || this.pool) return;
    try { const { createRequire } = await import("node:module"); const pg: any = createRequire(import.meta.url)("pg"); this.pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }); } catch {}
  }
  async upsert(r: UnifiedRecord) {
    await this.init(); if (!this.pool) return;
    await this.pool.query(`INSERT INTO unified_records(id,source,type,external_id,updated_at,status,project_id,name,amount_cents,currency,data)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,amount_cents=EXCLUDED.amount_cents,data=EXCLUDED.data,updated_at=EXCLUDED.updated_at`,
      [r.id, r.source, r.type, r.externalId, r.updatedAt, r.status, r.projectId || null, r.name, r.amountCents || null, r.currency, r.data]).catch(() => {});
  }
}
