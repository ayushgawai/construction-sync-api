import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

function App() {
  const [status, setStatus] = useState(null); const [invoices, setInvoices] = useState([]); const [err, setErr] = useState("");
  const load = async () => {
    try {
      setStatus(await (await fetch("/v1/sync/status")).json());
      setInvoices((await (await fetch("/v1/invoices?limit=20")).json()).items || []);
    } catch (e) { setErr("API unreachable — start it with: npm run dev (port 4000)"); }
  };
  useEffect(() => { load(); }, []);
  const sync = async () => { await fetch("/v1/sync", { method: "POST" }); load(); };
  return <main style={{ fontFamily: "system-ui", maxWidth: 900, margin: "2rem auto", padding: "0 1rem" }}>
    <h1>Construction Sync</h1><p>One schema over the ERP, project-management and job-costing systems.</p>
    {err && <p style={{ color: "crimson" }}>{err}</p>}
    <button onClick={sync}>Sync now</button>
    <h2>Linked accounts</h2>
    {!status ? <p>Loading…</p> : <table cellPadding="8"><thead><tr><th>Source</th><th>Status</th><th>Records</th><th>Agent</th></tr></thead>
      <tbody>{status.accounts.map(a => <tr key={a.id}><td>{a.label}</td><td>{a.status}</td><td>{a.records}</td><td>{status.agentConnected ? "connected" : "—"}</td></tr>)}</tbody></table>}
    <h2>Failed records ({status?.failed?.length || 0})</h2>
    <pre>{JSON.stringify(status?.failed || [], null, 2)}</pre>
    <h2>Invoices</h2>
    <table cellPadding="8"><thead><tr><th>ID</th><th>Source</th><th>Status</th><th>Amount</th></tr></thead>
      <tbody>{invoices.map(r => <tr key={r.id}><td>{r.name}</td><td>{r.source}</td><td>{r.status}</td><td>${((r.amountCents || 0) / 100).toLocaleString()}</td></tr>)}</tbody></table>
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);
