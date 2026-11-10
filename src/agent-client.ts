import WebSocket from "ws";
import { ErpAdapter } from "./adapters.js";
/** Run on-prem: `npm run agent` — dials out to the cloud, answers read-only ERP queries. */
const url = process.env.CLOUD_WS_URL || "ws://localhost:4000/agent";
const erp = new ErpAdapter();
const ws = new WebSocket(url);
ws.on("open", () => console.log(`agent connected -> ${url}, serving ${erp.label}`));
ws.on("message", raw => {
  const m = JSON.parse(String(raw));
  try { ws.send(JSON.stringify({ id: m.id, rows: erp.rawQuery(m.sql) })); }
  catch (e: any) { ws.send(JSON.stringify({ id: m.id, error: e.message })); }
});
ws.on("close", () => { console.log("agent disconnected, retry in 5s"); setTimeout(() => process.exit(1), 5000); }); // ponytail: let a supervisor (systemd/pm2) restart us
