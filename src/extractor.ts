export interface LLMClient { name: string; complete(prompt: string): Promise<string> }

/** Deterministic offline stub: the "model" is a small rule extractor, so eval is reproducible. */
export class StubLLM implements LLMClient {
  name = "stub-offline";
  async complete(prompt: string) { const marker = "plumbing=22-000.\n\n"; return extractRules(prompt.includes(marker) ? prompt.split(marker)[1] : prompt); }
}
export class ClaudeLLM implements LLMClient {
  name = "claude"; constructor(private key = process.env.ANTHROPIC_API_KEY || "", private model = process.env.LLM_MODEL || "claude-sonnet-5-5") {}
  async complete(prompt: string) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": this.key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: this.model, max_tokens: 2000, messages: [{ role: "user", content: prompt }] }) });
    if (!r.ok) throw new Error(`claude ${r.status}`); const j: any = await r.json(); return j.content.map((c: any) => c.text || "").join("");
  }
}
/** Any OpenAI-compatible /chat/completions endpoint. */
export class OpenAICompatLLM implements LLMClient {
  name = "openai-compatible"; constructor(private key = process.env.OPENAI_API_KEY || "", private base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1", private model = process.env.LLM_MODEL || "gpt-4o-mini") {}
  async complete(prompt: string) {
    const r = await fetch(`${this.base}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${this.key}`, "content-type": "application/json" }, body: JSON.stringify({ model: this.model, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } }) });
    if (!r.ok) throw new Error(`llm ${r.status}`); const j: any = await r.json(); return j.choices[0].message.content;
  }
}
export const defaultLLM = (): LLMClient => process.env.ANTHROPIC_API_KEY ? new ClaudeLLM() : process.env.OPENAI_API_KEY ? new OpenAICompatLLM() : new StubLLM();

const COST_CODES: [RegExp, string][] = [[/\b(concrete|cement|pour)\b/i, "03-300"], [/\b(rebar|reinforcing)\b/i, "03-200"], [/\b(steel|beam)\b/i, "05-100"], [/\b(lumber|framing|wood)\b/i, "06-100"], [/\b(electric\w*|conduit|wiring)\b/i, "26-000"], [/\b(pipe|plumbing)\b/i, "22-000"]];
export const mapCostCode = (desc: string) => COST_CODES.find(([re]) => re.test(desc))?.[1] || "01-000";

function extractRules(text: string): string {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const items = lines.filter(l => /\$|x\s*\d|\d+\s*@/i.test(l) && !/total/i.test(l)).map(l => {
    const nums = [...l.matchAll(/\$?([\d,]+\.\d{2}|\d+)/g)].map(m => Number(m[1].replaceAll(",", "")));
    const amount = nums.at(-1) || 0; const qty = nums.length > 1 ? nums[0] : 1;
    const description = l.replace(/\$?[\d,]+(\.\d{2})?/g, "").replace(/\s+/g, " ").replace(/[@$]\s*$/, "").trim() || l;
    return { description, quantity: qty, unitPriceCents: Math.round((qty ? amount / qty : amount) * 100), amountCents: Math.round(amount * 100), costCode: mapCostCode(l) };
  });
  const total = lines.find(l => /total/i.test(l)); const tm = total?.match(/([\d,]+\.\d{2})/);
  return JSON.stringify({
    vendor: lines.find(l => /vendor|from:/i.test(l))?.replace(/.*?:/i, "").trim() || lines[0] || "Unknown",
    invoiceNumber: text.match(/(?:invoice|inv)[#:\s]*([A-Za-z0-9-]+)/i)?.[1] || "UNKNOWN",
    date: text.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null,
    totalCents: tm ? Math.round(Number(tm[1].replaceAll(",", "")) * 100) : items.reduce((s, i) => s + i.amountCents, 0),
    lineItems: items,
  });
}
export async function extractInvoice(text: string, llm: LLMClient = defaultLLM()) {
  const prompt = `Extract this construction invoice as JSON {vendor,invoiceNumber,date,totalCents,lineItems:[{description,quantity,unitPriceCents,amountCents,costCode}]}. Map cost codes: concrete=03-300 rebar=03-200 steel=05-100 lumber=06-100 electrical=26-000 plumbing=22-000.\n\n${text}`;
  const raw = await llm.complete(prompt);
  const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  // Re-map cost codes deterministically — never trust the model for a code that drives accounting.
  for (const li of parsed.lineItems || []) li.costCode = mapCostCode(li.description || "");
  return { ...parsed, extractor: llm.name };
}

/** Synthetic invoice generator + ground truth for evaluation. */
const VENDORS = ["Acme Concrete Co", "Beacon Steel LLC", "Old Mill Lumber", "Summit Electrical"];
const ITEMS: [string, string, number][] = [["Concrete pour slab", "03-300", 8500], ["Rebar placement", "03-200", 4200], ["Structural steel beams", "05-100", 12050], ["Lumber framing package", "06-100", 3100], ["Electrical conduit run", "26-000", 2750]];
export function syntheticInvoice(i: number) {
  const vendor = VENDORS[i % VENDORS.length]; const n = 1 + (i % 3);
  const items = Array.from({ length: n }, (_, k) => { const [d, cc, price] = ITEMS[(i + k) % ITEMS.length]; const qty = 1 + ((i + k) % 4); return { description: d, quantity: qty, unitPriceCents: price * 100, amountCents: qty * price * 100, costCode: cc }; });
  const totalCents = items.reduce((s, x) => s + x.amountCents, 0);
  const truth = { vendor, invoiceNumber: `INV-${7000 + i}`, date: `2026-01-${String(1 + (i % 28)).padStart(2, "0")}`, totalCents, lineItems: items };
  const text = [`Vendor: ${vendor}`, `Invoice #: ${truth.invoiceNumber}`, `Date: ${truth.date}`, ...items.map(x => `${x.description} ${x.quantity} @ $${(x.unitPriceCents / 100).toFixed(2)} $${(x.amountCents / 100).toFixed(2)}`), `Total: $${(totalCents / 100).toFixed(2)}`].join("\n");
  return { text, truth };
}
