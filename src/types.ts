export type ResourceType = "vendors" | "invoices" | "commitments" | "change-orders" | "cost-codes";
export type SourceId = "erp" | "pm" | "jobcost";
export interface UnifiedRecord {
  id: string; // `${source}:${type}:${externalId}`
  source: SourceId; type: ResourceType; externalId: string;
  updatedAt: string; status: string; projectId?: string; name: string;
  amountCents?: number; currency: string;
  data: Record<string, unknown>;
}
export interface Query { source?: string; status?: string; projectId?: string; q?: string; since?: string; cursor?: string; limit?: number }
export interface Page { items: UnifiedRecord[]; nextCursor: string | null; total: number }
export interface Adapter {
  id: SourceId; label: string;
  list(type: ResourceType, q: Query): Promise<Page>;
  get(type: ResourceType, externalId: string): Promise<UnifiedRecord | null>;
  all(type: ResourceType): Promise<UnifiedRecord[]>;
}
export const TYPES: ResourceType[] = ["vendors", "invoices", "commitments", "change-orders", "cost-codes"];
export function paginate(items: UnifiedRecord[], q: Query): Page {
  let out = items;
  if (q.status) out = out.filter(r => r.status === q.status);
  if (q.projectId) out = out.filter(r => r.projectId === q.projectId);
  if (q.since) out = out.filter(r => r.updatedAt >= q.since!);
  if (q.q) { const s = q.q.toLowerCase(); out = out.filter(r => `${r.name} ${r.externalId}`.toLowerCase().includes(s)); }
  out = [...out].sort((a, b) => a.id.localeCompare(b.id));
  const offset = q.cursor ? Number(Buffer.from(q.cursor, "base64url").toString()) || 0 : 0;
  const limit = Math.min(Math.max(q.limit || 50, 1), 200);
  const slice = out.slice(offset, offset + limit);
  return { items: slice, total: out.length, nextCursor: offset + limit < out.length ? Buffer.from(String(offset + limit)).toString("base64url") : null };
}
export const rec = (source: SourceId, type: ResourceType, externalId: string, p: Partial<UnifiedRecord> & { name: string }): UnifiedRecord =>
  ({ id: `${source}:${type}:${externalId}`, source, type, externalId, updatedAt: "2026-01-01T00:00:00.000Z", status: "active", currency: "USD", data: {}, ...p });
