import type { Server } from "node:http";
/** Tiny supertest substitute — ponytail: avoids a dev dependency for 20 lines. */
export default async function request(app: any) {
  const server: Server = app.listen(0); await new Promise(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (method: string, path: string, body?: any) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  return { get: (p: string) => call("GET", p), post: (p: string, b?: any) => call("POST", p, b), close: () => server.close() };
}
