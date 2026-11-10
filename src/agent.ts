import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

/** Cloud side: on-prem agent dials OUT to us, so no inbound firewall holes at the site office. */
export class AgentHub {
  private agent: WebSocket | null = null; private pending = new Map<string, (v: any) => void>(); seq = 0;
  attach(server: Server) {
    const wss = new WebSocketServer({ server, path: "/agent" });
    wss.on("connection", ws => {
      this.agent = ws;
      ws.on("message", raw => { try { const m = JSON.parse(String(raw)); this.pending.get(m.id)?.(m); this.pending.delete(m.id); } catch {} });
      ws.on("close", () => { if (this.agent === ws) this.agent = null; });
    });
  }
  get connected() { return !!this.agent && this.agent.readyState === WebSocket.OPEN; }
  query(sql: string, timeoutMs = 5000): Promise<any> {
    if (!this.connected) return Promise.reject(new Error("on-prem agent not connected"));
    const id = String(++this.seq);
    return new Promise((resolve, reject) => {
      this.pending.set(id, m => m.error ? reject(new Error(m.error)) : resolve(m.rows));
      setTimeout(() => { this.pending.delete(id); reject(new Error("agent query timeout")); }, timeoutMs);
      this.agent!.send(JSON.stringify({ id, sql }));
    });
  }
}
