import { describe, it, expect, beforeAll } from "vitest";
import { defaultAdapters, CsvAdapter } from "../src/adapters.js";
import { TYPES, type Adapter } from "../src/types.js";

/** Contract suite: the SAME generated checks run against every adapter. */
export function adapterContract(make: () => Adapter, onlyTypes?: string[]) {
  describe(`contract:${make().id}`, () => {
    const a = make();
    for (const type of TYPES.filter(t => !onlyTypes || onlyTypes.includes(t))) {
      it(`${type}: schema + pagination`, async () => {
        const page = await a.list(type, { limit: 2 });
        for (const r of page.items) {
          expect(r.id).toBe(`${a.id}:${type}:${r.externalId}`); expect(r.source).toBe(a.id);
          expect(r.type).toBe(type); expect(r.name.length).toBeGreaterThan(0); expect(r.currency).toBe("USD");
          expect(() => new Date(r.updatedAt).toISOString()).not.toThrow();
        }
        if (page.nextCursor) { const p2 = await a.list(type, { limit: 2, cursor: page.nextCursor }); expect(p2.items[0]?.id).not.toBe(page.items[0]?.id); }
        const one = page.items[0]; if (one) expect((await a.get(type, one.externalId))?.id).toBe(one.id);
        expect(await a.get(type, "__missing__")).toBeNull();
      });
      it(`${type}: filters are source-agnostic`, async () => {
        const all = await a.all(type);
        if (all[0]?.projectId) expect((await a.list(type, { projectId: all[0].projectId })).items.every(r => r.projectId === all[0].projectId)).toBe(true);
        expect((await a.list(type, { status: "__nope__" })).items).toHaveLength(0);
      });
    }
  });
}
adapterContract(() => defaultAdapters()[0]);
adapterContract(() => defaultAdapters()[1]);
adapterContract(() => new CsvAdapter("", "JOB_NO,PRJ_ID,CST_CD,DESCR,BUDGET_AMT,ACTUAL_AMT,COMMIT_AMT,STAT,UPD_DT\nJC-9,P-1,03-300,Concrete,100,50,80,A,2026-01-01\n"), ["cost-codes"]);
beforeAll(() => {});
