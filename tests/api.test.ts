import { describe, it, expect } from "vitest";
import request from "./http.js";
import { createApp } from "../src/app.js";
import { extractInvoice, syntheticInvoice } from "../src/extractor.js";
import { ErpAdapter } from "../src/adapters.js";

describe("api", () => {
  it("unified list, filter, pagination, get, analytics cache, sync", async () => {
    const { app, watcher } = createApp(); const base = await request(app);
    const inv = await base.get("/v1/invoices?source=erp"); expect(inv.body.items.length).toBeGreaterThan(0); expect(inv.body.items.every((r: any) => r.source === "erp")).toBe(true);
    const one = inv.body.items[0]; expect((await base.get(`/v1/invoices/${encodeURIComponent(one.id)}`)).body.id).toBe(one.id);
    expect((await base.get("/v1/vendors?status=active")).status).toBe(200);
    const a1: any = await base.get("/v1/analytics/cost-summary"); const a2: any = await base.get("/v1/analytics/cost-summary");
    expect(a1.body.cached).toBe(false); expect(a2.body.cached).toBe(true);
    expect((await base.post("/v1/sync")).body.changed).toBeGreaterThan(0);
    expect((await base.get("/v1/events")).body.items.length).toBeGreaterThan(0);
    expect((await base.get("/v1/sync/status")).body.accounts).toHaveLength(3);
    expect(watcher.events.length).toBeGreaterThan(0);
  });
  it("rejects bad input", async () => {
    const base = await request(createApp().app);
    expect((await base.post("/v1/extract/invoice", {})).status).toBe(400);
    expect((await base.post("/v1/webhooks", {})).status).toBe(400);
    expect((await base.post("/v1/agent/query", { sql: "SELECT 1" })).status).toBe(503);
  });
});
describe("on-prem agent (dial-out websocket)", () => {
  it("cloud queries ERP through the agent; writes are rejected", async () => {
    const { createServer } = await import("node:http"); const WebSocket = (await import("ws")).default;
    const { app, hub } = createApp(); const server = createServer(app); hub.attach(server);
    await new Promise(r => server.listen(0, r)); const port = (server.address() as any).port;
    const erp = new ErpAdapter();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent`);
    ws.on("message", raw => { const m = JSON.parse(String(raw)); try { ws.send(JSON.stringify({ id: m.id, rows: erp.rawQuery(m.sql) })); } catch (e: any) { ws.send(JSON.stringify({ id: m.id, error: e.message })); } });
    await new Promise(r => ws.once("open", r)); await new Promise(r => setTimeout(r, 50));
    expect(hub.connected).toBe(true);
    expect((await hub.query("SELECT VND_NM FROM VNDMST WHERE VND_ID='V100'"))[0].VND_NM).toContain("Acme");
    await expect(hub.query("DELETE FROM VNDMST")).rejects.toThrow(/read-only/);
    ws.close(); server.close();
  });
});
describe("extractor + erp guard", () => {
  it("extracts a synthetic invoice exactly", async () => {
    const { text, truth } = syntheticInvoice(3); const got: any = await extractInvoice(text);
    expect(got.vendor).toBe(truth.vendor); expect(got.totalCents).toBe(truth.totalCents); expect(got.lineItems[0].costCode).toBe(truth.lineItems[0].costCode);
  });
  it("agent SQL guard blocks writes", () => { const e = new ErpAdapter(); expect(() => e.rawQuery("DELETE FROM VNDMST")).toThrow(); expect(e.rawQuery("SELECT VND_ID FROM VNDMST").length).toBeGreaterThan(0); });
});
