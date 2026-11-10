# construction-sync-api

A unified API platform that connects fragmented, decades-old construction finance and
project-management systems under one standard schema: vendors, invoices, commitments,
change orders and cost codes — queried the same way regardless of which system owns them.

## Design

```
                        ┌──────────────────────────────────────────────┐
                        │              Cloud (this repo)               │
  Browser ────────────► │  React Sync dashboard (web/, Vite)           │
                        │        │ dog-foods ↓                         │
                        │  Express API  /v1/{vendors,invoices,         │
                        │   commitments,change-orders,cost-codes}      │
                        │   ├─ system-agnostic filters + cursor paging │
                        │   ├─ /v1/analytics/*  ──► Redis cache*       │
                        │   ├─ /v1/sync /v1/events /v1/webhooks        │
                        │   ├─ /v1/extract/invoice ─► LLM (Claude /    │
                        │   │    OpenAI-compatible / offline stub)     │
                        │   ├─ /v1/agent/query ──► AgentHub (WS server)│
                        │   └─ unified records ──► PostgreSQL mirror*  │
                        └───────┬──────────────────┬───────────────────┘
                 dials OUT over WS │                  │ poll + SHA-256 hash
                        ┌──────────▼─────────┐  ┌─────▼──────────────────┐
                        │ On-prem agent      │  │ Synthesized webhooks:  │
                        │ (site office, no   │  │ sources have none, so  │
                        │  inbound firewall) │  │ changes are detected   │
                        │  read-only SELECT  │  │ and POSTed to subs     │
                        └──────────┬─────────┘  └────────────────────────┘
              ┌────────────────────┼─────────────────────┐
     ┌────────▼────────┐  ┌────────▼────────┐   ┌────────▼────────┐
     │ ERP (SQLite,    │  │ PM system       │   │ Job-costing     │
     │ old-style VNDMST│  │ (REST, simulated│   │ flat file (CSV) │
     │ /APINV/PO_MST)  │  │  upstream)      │   │ export          │
     └─────────────────┘  └─────────────────┘   └─────────────────┘
     * Redis/Postgres are used when REDIS_URL / DATABASE_URL are set; otherwise an
       in-process cache / live-adapter reads are used so everything runs on a laptop.
```

| Piece | Choice | Why / ceiling |
|---|---|---|
| API | TypeScript, Express 4, Node ≥ 22 (`node:sqlite`) | No native DB driver to compile; SQLite ERP is a real file with an old-style schema |
| Unified model | One `UnifiedRecord` per entity, `id = source:type:externalId`, money in integer cents | System-agnostic `?source&status&projectId&q&since` filters + opaque cursor pagination over the id-sorted merged set |
| Adapters | `ErpAdapter` (SQL), `PmAdapter` (REST-shaped), `CsvAdapter` (flat file) behind one `Adapter` interface | The contract suite (below) runs the *same* generated checks against all three |
| On-prem agent | Agent dials **out** via WebSocket (`src/agent-client.ts`); cloud proxies read-only queries | No inbound firewall holes. Agent rejects anything but a single `SELECT` |
| Webhooks | Poll + SHA-256 of each record; `record.created/updated` events POSTed to subscribers | For systems with no webhooks. Poll interval is the freshness ceiling (30 s default) |
| Cache | Redis (`ioredis`, lazy) or in-process TTL Map, same interface | Analytics endpoints are read-heavy; hit-rate exposed at `/v1/analytics/cache-stats` |
| Postgres | `sql/schema.sql`; records mirrored there on sync when `DATABASE_URL` is set | Without it, reads go straight to adapters (fine at this seed scale, not at 10⁶ records) |
| AI extractor | Pluggable `LLMClient`: Claude, OpenAI-compatible, deterministic offline stub | Cost codes are re-mapped deterministically after the model answers — never trust an LLM for an accounting code |
| Tests | Vitest; contract framework generates the same suite per adapter + endpoint/agent tests | 27 tests, no external services needed |
| Dashboard | React + Vite (`web/`), proxies `/v1` to the API | Dog-foods linked accounts, sync status, failed records, invoices |

## Run

```bash
npm install
npm run seed          # creates data/erp.sqlite (old-style ERP) — also auto-seeded on first use
npm run dev           # API on :4000   (PORT=… to change)
npm run agent         # in another terminal: on-prem agent dials ws://localhost:4000/agent
npm install --prefix web && npm run dev --prefix web   # dashboard on :5173

curl localhost:4000/health
curl 'localhost:4000/v1/invoices?source=erp&limit=2'
curl 'localhost:4000/v1/invoices?cursor=<nextCursor>'
curl localhost:4000/v1/analytics/cost-summary
curl -XPOST localhost:4000/v1/sync
curl -XPOST localhost:4000/v1/extract/invoice -H 'content-type: application/json' \
  -d '{"text":"Vendor: Acme Concrete Co\nInvoice #: INV-1\nDate: 2026-01-04\nConcrete pour slab 2 @ $8500.00 $17000.00\nTotal: $17000.00"}'
curl -XPOST localhost:4000/v1/agent/query -H 'content-type: application/json' \
  -d '{"sql":"SELECT VND_NM FROM VNDMST"}'        # needs the agent running
docker compose up -d  # optional real Postgres :5432 + Redis :6379 (set DATABASE_URL / REDIS_URL)
```

Env: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`, `LLM_MODEL`)
switch the extractor from the offline stub to a real model.

## Test

```bash
npm test              # 27 tests: contract suite × every adapter, API, agent-over-WS, extractor
npm run typecheck
```

## Bench & eval (laptop sanity runs)

Copied from an actual run on a laptop (Apple Silicon, Node 26). These are sanity
numbers at seed scale, **not** production load tests.

```bash
npm run bench         # BENCH_N=500 in-process requests to /v1/analytics/cost-summary
```
```json
{
  "requests": 500, "errors": 0, "cacheBackend": "memory", "cacheHitRate": 0.998,
  "hits": 499, "misses": 1, "p50ms": 0.13, "p99ms": 0.6,
  "note": "first request is a miss; rest should hit the 60s TTL cache"
}
```

```bash
npm run eval          # 200 synthetic invoices, field-level accuracy, offline stub
```
```
invoices=200 fieldAccuracy=100.00% (2396/2396) extractor=stub-offline
  vendor: 100.00%   invoiceNumber: 100.00%   date: 100.00%   totalCents: 100.00%
  line.description / quantity / amountCents / costCode: 100.00%
```
⚠️ The 100% is the *deterministic stub parsing its own templated synthetic invoices* —
it proves the eval harness and cost-code mapping, not real-world OCR/LLM accuracy.
Run with a real API key set to measure an actual model; expect materially lower numbers
on messy scanned invoices.

## Honest limitations / unfinished

- **PM system is simulated in-process** (`PmAdapter.fetchPm`); point it at a real REST
  base URL + token to use it for real. ERP and CSV adapters read real files.
- **Postgres is a mirror, not the primary store** yet: without `DATABASE_URL` reads are
  live adapter reads merged in memory — fine for seeds, won't scale to millions of rows.
- **Agent has no auth token / TLS termination** in this build; deploy behind `wss://`
  and add a shared secret before exposing it. SQL guard is a conservative regex allowlist.
- Webhook delivery is fire-and-forget (no retries/DLQ); subscriber list is in-memory.
- Cache invalidation is TTL-only (60 s) — analytics can be up to a minute stale.
- The extractor's stub understands only the templated invoice format; real extraction
  needs a key-backed model, and its accuracy on real documents is unmeasured here.
- Dashboard is intentionally small: no auth, no record detail/edit views.
