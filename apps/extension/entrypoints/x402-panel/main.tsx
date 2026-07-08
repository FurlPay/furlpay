import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "@/assets/global.css";

// FurlPay x402 Network Inspector — "Postman for x402".
// Live-captures HTTP 402 responses on the inspected page via
// devtools.network.onRequestFinished, decodes the PaymentRequirements body,
// and renders a request table + detail pane.

interface CapturedEntry {
  id: number;
  url: string;
  method: string;
  status: number;
  time: string;
  requirements: Record<string, unknown>[];
  rawBody: string;
  responseHeaders: { name: string; value: string }[];
}

let nextId = 1;

function Panel() {
  const [entries, setEntries] = useState<CapturedEntry[]>([]);
  const [selected, setSelected] = useState<CapturedEntry | null>(null);

  useEffect(() => {
    const handler = (request: any) => {
      if (request?.response?.status !== 402) return;
      request.getContent((content: string) => {
        let requirements: Record<string, unknown>[] = [];
        try {
          const body = JSON.parse(content);
          if (Array.isArray(body?.accepts)) requirements = body.accepts;
          else if (body && typeof body === "object") requirements = [body];
        } catch {
          /* non-JSON 402 */
        }
        const entry: CapturedEntry = {
          id: nextId++,
          url: request.request.url,
          method: request.request.method,
          status: request.response.status,
          time: new Date().toLocaleTimeString(),
          requirements,
          rawBody: content ?? "",
          responseHeaders: request.response.headers ?? [],
        };
        setEntries((prev) => [entry, ...prev].slice(0, 200));
      });
    };
    browser.devtools.network.onRequestFinished.addListener(handler);
    return () => browser.devtools.network.onRequestFinished.removeListener(handler);
  }, []);

  const cell: React.CSSProperties = { padding: "6px 10px", borderBottom: "1px solid var(--fp-border-glass)", fontSize: "0.78rem", whiteSpace: "nowrap" };
  const first = (e: CapturedEntry) => e.requirements[0] ?? {};
  const amountUsd = (e: CapturedEntry) => {
    const raw = Number(first(e).maxAmountRequired);
    return Number.isFinite(raw) ? `$${(raw / 1e6).toFixed(2)}` : "—";
  };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "var(--fp-font-sans)" }}>
      <div style={{ flex: 1.3, overflow: "auto", borderRight: "1px solid var(--fp-border-glass)" }}>
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--fp-border-glass)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>x402 responses ({entries.length})</span>
          <button className="btn-ghost" style={{ padding: "4px 12px", fontSize: "0.72rem" }} onClick={() => { setEntries([]); setSelected(null); }}>
            Clear
          </button>
        </div>
        {entries.length === 0 ? (
          <div style={{ padding: 24, color: "var(--fp-text-muted)", fontSize: "0.8rem" }}>
            Waiting for HTTP 402 traffic… Browse a page that serves x402-priced resources and requests will appear here live.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--fp-text-secondary)", textAlign: "left" }}>
                <th style={cell}>Time</th>
                <th style={cell}>Method</th>
                <th style={cell}>URL</th>
                <th style={cell}>Amount</th>
                <th style={cell}>Network</th>
                <th style={cell}>Pay to</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => setSelected(e)}
                  style={{ cursor: "pointer", background: selected?.id === e.id ? "rgba(16,185,129,0.08)" : "transparent" }}
                >
                  <td style={cell}>{e.time}</td>
                  <td style={{ ...cell, fontFamily: "var(--fp-font-mono)" }}>{e.method}</td>
                  <td style={{ ...cell, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>{e.url}</td>
                  <td style={{ ...cell, fontFamily: "var(--fp-font-mono)", color: "var(--fp-accent-2)" }}>{amountUsd(e)}</td>
                  <td style={cell}>{String(first(e).network ?? "—")}</td>
                  <td style={{ ...cell, fontFamily: "var(--fp-font-mono)", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {String(first(e).payTo ?? "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
        {selected ? (
          <>
            <h3 className="section-title">PaymentRequirements</h3>
            <pre style={{ background: "var(--fp-bg-secondary)", border: "1px solid var(--fp-border-glass)", borderRadius: 10, padding: 12, fontSize: "0.74rem", overflow: "auto", fontFamily: "var(--fp-font-mono)" }}>
              {selected.requirements.length ? JSON.stringify(selected.requirements, null, 2) : selected.rawBody || "(empty body)"}
            </pre>
            <h3 className="section-title" style={{ marginTop: 14 }}>Response headers</h3>
            <pre style={{ background: "var(--fp-bg-secondary)", border: "1px solid var(--fp-border-glass)", borderRadius: 10, padding: 12, fontSize: "0.72rem", overflow: "auto", fontFamily: "var(--fp-font-mono)" }}>
              {selected.responseHeaders.map((h) => `${h.name}: ${h.value}`).join("\n") || "(none)"}
            </pre>
          </>
        ) : (
          <div style={{ color: "var(--fp-text-muted)", fontSize: "0.8rem", padding: 12 }}>
            Select a captured 402 response to inspect its EIP-3009 payment requirements.
          </div>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>
);
