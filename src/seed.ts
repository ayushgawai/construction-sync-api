import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as any;
import fs from "node:fs"; import path from "node:path";
/** Creates the simulated decades-old on-prem ERP: terse tables/columns, codes not names. */
export function seedErp(file = process.env.ERP_SQLITE || "data/erp.sqlite") {
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE VNDMST(VND_ID TEXT PRIMARY KEY,VND_NM TEXT,VND_ST TEXT,TAX_ID TEXT,UPD_DT TEXT);
CREATE TABLE APINV(INV_ID TEXT PRIMARY KEY,VND_ID TEXT,PRJ_ID TEXT,INV_DT TEXT,DUE_DT TEXT,AMT REAL,STAT_CD TEXT,UPD_DT TEXT);
CREATE TABLE APINV_LN(INV_ID TEXT,LN INT,DESCR TEXT,QTY REAL,UNIT_AMT REAL,CST_CD TEXT);
CREATE TABLE PO_MST(PO_ID TEXT PRIMARY KEY,VND_ID TEXT,PRJ_ID TEXT,AMT REAL,STAT_CD TEXT,UPD_DT TEXT);
CREATE TABLE CO_MST(CO_ID TEXT PRIMARY KEY,PRJ_ID TEXT,AMT REAL,STAT_CD TEXT,DESCR TEXT,UPD_DT TEXT);
CREATE TABLE CSTCD(CST_CD TEXT PRIMARY KEY,DESCR TEXT,DIV_CD TEXT);`);
  const v = db.prepare("INSERT INTO VNDMST VALUES(?,?,?,?,?)");
  [["V100","Acme Concrete Co","A","12-345","2026-01-05"],["V101","Beacon Steel LLC","A","98-765","2026-01-06"],["V102","Old Mill Lumber","H","55-111","2026-01-07"]].forEach(r=>v.run(...r));
  const i = db.prepare("INSERT INTO APINV VALUES(?,?,?,?,?,?,?,?)");
  [["INV-9001","V100","P-100","2026-01-10","2026-02-09",125000.5,"O","2026-01-10"],["INV-9002","V101","P-100","2026-01-12","2026-02-11",48200,"P","2026-01-13"],["INV-9003","V102","P-200","2026-01-15","2026-02-14",0,"O","2026-01-15"]].forEach(r=>i.run(...r));
  const l = db.prepare("INSERT INTO APINV_LN VALUES(?,?,?,?,?,?)");
  [["INV-9001",1,"Concrete pour foundation",10,8500,"03-300"],["INV-9001",2,"Rebar placement",1,40000.5,"03-200"],["INV-9002",1,"Structural steel beams",4,12050,"05-100"]].forEach(r=>l.run(...r));
  const po = db.prepare("INSERT INTO PO_MST VALUES(?,?,?,?,?,?)");
  [["PO-501","V100","P-100",300000,"O","2026-01-08"],["PO-502","V101","P-200",175000,"C","2026-01-09"]].forEach(r=>po.run(...r));
  const co = db.prepare("INSERT INTO CO_MST VALUES(?,?,?,?,?,?)");
  [["CO-71","P-100",25000,"A","Added elevator shaft","2026-01-20"],["CO-72","P-200",-5000,"P","Deduct unused allowance","2026-01-21"]].forEach(r=>co.run(...r));
  const cc = db.prepare("INSERT INTO CSTCD VALUES(?,?,?)");
  [["03-200","Rebar","03"],["03-300","Concrete","03"],["05-100","Structural Steel","05"],["06-100","Lumber & Framing","06"]].forEach(r=>cc.run(...r));
  db.close(); return file;
}
if (import.meta.url === `file://${process.argv[1]}`) console.log("seeded", seedErp());
