import { extractInvoice, syntheticInvoice } from "./extractor.js";
const N = Number(process.env.EVAL_N || 200);
let fields = 0, correct = 0; const per: Record<string, [number, number]> = {};
const check = (k: string, ok: boolean) => { fields++; correct += +ok; per[k] ??= [0, 0]; per[k][1]++; per[k][0] += +ok; };
for (let i = 0; i < N; i++) {
  const { text, truth } = syntheticInvoice(i); const got: any = await extractInvoice(text);
  check("vendor", got.vendor === truth.vendor); check("invoiceNumber", got.invoiceNumber === truth.invoiceNumber);
  check("date", got.date === truth.date); check("totalCents", got.totalCents === truth.totalCents);
  truth.lineItems.forEach((li, k) => { const g = got.lineItems?.[k]; check("line.description", g?.description === li.description); check("line.quantity", g?.quantity === li.quantity); check("line.amountCents", g?.amountCents === li.amountCents); check("line.costCode", g?.costCode === li.costCode); });
}
console.log(`invoices=${N} fieldAccuracy=${(correct / fields * 100).toFixed(2)}% (${correct}/${fields}) extractor=stub-offline`);
for (const [k, [c, t]] of Object.entries(per)) console.log(`  ${k}: ${(c / t * 100).toFixed(2)}% (${c}/${t})`);
