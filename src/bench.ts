import { createApp } from "./app.js";
// Laptop sanity load test: in-process requests against the analytics endpoint (no network noise).
const { app } = createApp();
const server = app.listen(0); await new Promise(r => server.once("listening", r));
const port = (server.address() as any).port; const url = `http://127.0.0.1:${port}/v1/analytics/cost-summary`;
const N = Number(process.env.BENCH_N || 500);
const lat: number[] = []; let errors = 0;
for (let i = 0; i < N; i++) { const t = performance.now(); const r = await fetch(url); r.ok ? await r.json() : errors++; lat.push(performance.now() - t); }
lat.sort((a, b) => a - b); const p = (q: number) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))].toFixed(2);
const stats = await (await fetch(`http://127.0.0.1:${port}/v1/analytics/cache-stats`)).json();
console.log(JSON.stringify({ requests: N, errors, cacheBackend: stats.backend, cacheHitRate: stats.hitRate, hits: stats.hits, misses: stats.misses, p50ms: +p(.5), p99ms: +p(.99), note: "first request is a miss; rest should hit the 60s TTL cache" }, null, 2));
server.close();
