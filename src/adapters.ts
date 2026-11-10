import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as any;
import fs from "node:fs";
import { seedErp } from "./seed.js";
import { paginate, rec, type Adapter, type Query, type ResourceType, type UnifiedRecord } from "./types.js";

const cents = (dollars: number) => Math.round(Number(dollars || 0) * 100);
const st: Record<string, string> = { A: "active", H: "on_hold", O: "open", P: "paid", C: "closed" };
const mapSt = (c: string) => st[c] || "active";

/* ---- 1. On-prem SQL ERP (SQLite, old-style schema) ---- */
export class ErpAdapter implements Adapter {
  id = "erp" as const; label = "On-prem Accounting ERP (SQLite)";
  db: any;
  constructor(file?: string) { this.db = new DatabaseSync(seedErp(file)); }
  private rows(type: ResourceType): UnifiedRecord[] {
    const q = (s: string) => this.db.prepare(s).all() as any[];
    switch (type) {
      case "vendors": return q("SELECT * FROM VNDMST").map(r => rec("erp", type, r.VND_ID, { name: r.VND_NM, status: mapSt(r.VND_ST), updatedAt: r.UPD_DT + "T00:00:00.000Z", data: { taxId: r.TAX_ID } }));
      case "invoices": return q("SELECT * FROM APINV").map(r => rec("erp", type, r.INV_ID, { name: `Invoice ${r.INV_ID}`, status: mapSt(r.STAT_CD), projectId: r.PRJ_ID, amountCents: cents(r.AMT), updatedAt: r.UPD_DT + "T00:00:00.000Z", data: { vendorId: `erp:vendors:${r.VND_ID}`, dueDate: r.DUE_DT, lines: q(`SELECT * FROM APINV_LN WHERE INV_ID='${r.INV_ID.replaceAll("'", "''")}'`).map(l => ({ description: l.DESCR, quantity: l.QTY, unitPriceCents: cents(l.UNIT_AMT), costCode: l.CST_CD })) } }));
      case "commitments": return q("SELECT * FROM PO_MST").map(r => rec("erp", type, r.PO_ID, { name: `Commitment ${r.PO_ID}`, status: mapSt(r.STAT_CD), projectId: r.PRJ_ID, amountCents: cents(r.AMT), updatedAt: r.UPD_DT + "T00:00:00.000Z", data: { vendorId: `erp:vendors:${r.VND_ID}` } }));
      case "change-orders": return q("SELECT * FROM CO_MST").map(r => rec("erp", type, r.CO_ID, { name: r.DESCR, status: mapSt(r.STAT_CD), projectId: r.PRJ_ID, amountCents: cents(r.AMT), updatedAt: r.UPD_DT + "T00:00:00.000Z", data: {} }));
      case "cost-codes": return q("SELECT * FROM CSTCD").map(r => rec("erp", type, r.CST_CD, { name: r.DESCR, data: { division: r.DIV_CD, code: r.CST_CD } }));
    }
  }
  async all(type: ResourceType) { return this.rows(type); }
  async list(type: ResourceType, query: Query) { return paginate(this.rows(type), query); }
  async get(type: ResourceType, id: string) { return this.rows(type).find(r => r.externalId === id) || null; }
  /** Read-only SQL for the on-prem agent. SELECT only — trust boundary. */
  rawQuery(sql: string) {
    if (!/^\s*select\b/i.test(sql) || /;|--|\b(drop|delete|update|insert|alter)\b/i.test(sql)) throw new Error("only single read-only SELECT allowed");
    return this.db.prepare(sql).all();
  }
}

/* ---- 2. REST project-management system (simulated upstream) ---- */
const PM: Record<ResourceType, UnifiedRecord[]> = {
  vendors: [rec("pm", "vendors", "pm-v1", { name: "Summit Electrical", data: { trade: "electrical" } })],
  invoices: [rec("pm", "invoices", "pm-inv-1", { name: "Pay App 12", status: "open", projectId: "P-100", amountCents: 9_900_000, updatedAt: "2026-01-22T00:00:00.000Z", data: {} })],
  commitments: [rec("pm", "commitments", "pm-c1", { name: "Subcontract SC-9", status: "open", projectId: "P-100", amountCents: 22_000_000, data: {} })],
  "change-orders": [rec("pm", "change-orders", "pm-co-1", { name: "RFI-44 added conduit", status: "pending", projectId: "P-100", amountCents: 1_850_000, data: {} })],
  "cost-codes": [rec("pm", "cost-codes", "26-000", { name: "Electrical", data: { code: "26-000" } })],
};
export class PmAdapter implements Adapter {
  id = "pm" as const; label = "Project Management REST API (simulated)";
  // ponytail: simulated upstream in-process; swap fetchPm() for real fetch(baseUrl) when credentials exist.
  async fetchPm(type: ResourceType) { return PM[type]; }
  async all(type: ResourceType) { return this.fetchPm(type); }
  async list(type: ResourceType, q: Query) { return paginate(await this.fetchPm(type), q); }
  async get(type: ResourceType, id: string) { return (await this.fetchPm(type)).find(r => r.externalId === id) || null; }
}

/* ---- 3. CSV / flat-file job-costing export ---- */
export class CsvAdapter implements Adapter {
  id = "jobcost" as const; label = "Job-Costing CSV Export";
  constructor(private file = process.env.JOBCOST_CSV || "data/jobcost.csv", private text?: string) {}
  private parse(): UnifiedRecord[] {
    const txt = this.text ?? fs.readFileSync(this.file, "utf8");
    const [head, ...lines] = txt.trim().split(/\r?\n/);
    const cols = head.split(",");
    return lines.filter(Boolean).map(line => {
      const v = line.split(","); const o: any = {}; cols.forEach((c, i) => o[c] = v[i]);
      return rec("jobcost", "cost-codes", o.JOB_NO, { name: `${o.CST_CD} ${o.DESCR}`, status: mapSt(o.STAT), projectId: o.PRJ_ID, amountCents: cents(o.ACTUAL_AMT), updatedAt: o.UPD_DT + "T00:00:00.000Z", data: { code: o.CST_CD, budgetCents: cents(o.BUDGET_AMT), committedCents: cents(o.COMMIT_AMT) } });
    });
  }
  async all(type: ResourceType) { return type === "cost-codes" ? this.parse() : []; }
  async list(type: ResourceType, q: Query) { return paginate(await this.all(type), q); }
  async get(type: ResourceType, id: string) { return (await this.all(type)).find(r => r.externalId === id) || null; }
}
export const defaultAdapters = (): Adapter[] => [new ErpAdapter(), new PmAdapter(), new CsvAdapter()];
