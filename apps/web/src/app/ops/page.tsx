"use client";

import { useCallback, useEffect, useState } from "react";

// FurlPay Ops — phase 1 control plane. Reads the real ops endpoints and its
// pause controls enforce real server-side behavior (durable Redis flags wired
// into every live money route via assertRailActive). No fabricated metrics.

type RailRow = {
  rail: string;
  status: string;
  armed: boolean;
  total: number;
  settled: number;
  pending: number;
  failed: number;
  rejected: number;
  volumeUsd: number;
  feeUsd: number;
  successRate: number | null;
};

type Overview = {
  globalPaused: boolean;
  totals: { volumeUsd: number; feeUsd: number; transactions: number; settled: number; pending: number; failed: number; successRate: number | null };
  rails: RailRow[];
  futureRails: { rail: string; status: string }[];
  config: any;
};

type SecEvent = { id: string; kind: string; rail: string; severity: string; detail: string; ts: string };
type TxEvent = { id: string; rail: string; state: string; substate?: string; amountUsd?: number; txHash?: string; ts: string };

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);

async function getJson(url: string) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

export default function OpsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [security, setSecurity] = useState<SecEvent[]>([]);
  const [txs, setTxs] = useState<TxEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const o = await getJson("/api/ops/overview");
    if (o.status === 401 || o.status === 403) {
      setError("Admin access required. Sign in with an admin account.");
      return;
    }
    if (!o.body?.ok) {
      setError(o.body?.error?.message ?? "Failed to load ops overview.");
      return;
    }
    setError(null);
    setOverview(o.body.data);
    const [s, t] = await Promise.all([getJson("/api/ops/security?limit=25"), getJson("/api/ops/transactions?limit=25")]);
    if (s.body?.ok) setSecurity(s.body.data.events);
    if (t.body?.ok) setTxs(t.body.data.transactions);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const setPause = useCallback(
    async (scope: "global" | "rail", rail: string | null, paused: boolean) => {
      let reason: string | undefined;
      if (!paused || scope === "global") {
        reason = window.prompt(`Reason for ${paused ? "pausing" : "resuming"} ${rail ?? "ALL rails"} (min 8 chars):`) ?? undefined;
        if (!reason || reason.trim().length < 8) return;
      }
      setBusy(`${scope}:${rail}`);
      const r = await fetch("/api/ops/controls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, rail: rail ?? undefined, paused, reason }),
      });
      setBusy(null);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        alert(b?.error?.message ?? "Control change failed.");
      }
      await load();
    },
    [load]
  );

  if (error) {
    return (
      <main style={S.page}>
        <h1 style={S.h1}>FurlPay Ops</h1>
        <div style={{ ...S.card, borderColor: "#b91c1c" }}>{error}</div>
      </main>
    );
  }
  if (!overview) return <main style={S.page}><p style={S.muted}>Loading real ops data…</p></main>;

  const o = overview;
  return (
    <main style={S.page}>
      <div style={S.headerRow}>
        <h1 style={S.h1}>FurlPay Ops</h1>
        <div style={S.headerRight}>
          <span style={S.muted}>auto-refresh 15s</span>
          <button
            style={{ ...S.btn, ...(o.globalPaused ? S.btnResume : S.btnDanger) }}
            disabled={busy === "global:null"}
            onClick={() => setPause("global", null, !o.globalPaused)}
          >
            {o.globalPaused ? "RESUME ALL RAILS" : "GLOBAL PAUSE"}
          </button>
        </div>
      </div>

      {o.globalPaused && <div style={{ ...S.card, borderColor: "#b45309", color: "#b45309" }}>GLOBAL PAUSE ACTIVE — all money movement halted.</div>}

      {/* Totals */}
      <section style={S.tiles}>
        <Tile label="Settled volume (90d)" value={money(o.totals.volumeUsd)} />
        <Tile label="Fees earned (90d)" value={money(o.totals.feeUsd)} />
        <Tile label="Transactions" value={String(o.totals.transactions)} />
        <Tile label="Success rate" value={pct(o.totals.successRate)} />
        <Tile label="Pending" value={String(o.totals.pending)} />
        <Tile label="Failed" value={String(o.totals.failed)} />
      </section>

      {/* Rail matrix */}
      <h2 style={S.h2}>Payment rails</h2>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>{["Rail", "Status", "Armed", "Txns", "Settled", "Pending", "Failed", "Success", "Volume", "Revenue", "Control"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {o.rails.map((r) => (
              <tr key={r.rail}>
                <td style={S.td}><b>{r.rail}</b></td>
                <td style={S.td}><StatusBadge status={r.status} /></td>
                <td style={S.td}>{r.armed ? "live" : "mock"}</td>
                <td style={S.td}>{r.total}</td>
                <td style={S.td}>{r.settled}</td>
                <td style={S.td}>{r.pending}</td>
                <td style={S.td}>{r.failed}</td>
                <td style={S.td}>{pct(r.successRate)}</td>
                <td style={S.td}>{money(r.volumeUsd)}</td>
                <td style={S.td}>{money(r.feeUsd)}</td>
                <td style={S.td}>
                  <button
                    style={{ ...S.btnSm, ...(r.status === "PAUSED" ? S.btnResume : S.btnDanger) }}
                    disabled={busy === `rail:${r.rail}` || o.globalPaused}
                    onClick={() => setPause("rail", r.rail, r.status !== "PAUSED")}
                  >
                    {r.status === "PAUSED" ? "resume" : "pause"}
                  </button>
                </td>
              </tr>
            ))}
            {o.futureRails.map((r) => (
              <tr key={r.rail} style={{ opacity: 0.5 }}>
                <td style={S.td}><b>{r.rail}</b></td>
                <td style={S.td}><StatusBadge status={r.status} /></td>
                <td style={S.td} colSpan={9}>not configured</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={S.twoCol}>
        {/* Config readiness */}
        <div>
          <h2 style={S.h2}>Configuration readiness</h2>
          <div style={S.card}>
            <ConfigGroup title="x402 mainnet settlement" armed={o.config.x402.armed} rows={o.config.x402} />
            <ConfigGroup title="LI.FI swaps" armed={o.config.lifi.armed} rows={{ LIFI_API_KEY: o.config.lifi.LIFI_API_KEY, integrator: o.config.lifi.LIFI_INTEGRATOR, fee: o.config.lifi.LIFI_FEE }} />
            <ConfigGroup title="CCTP V2" armed={o.config.cctp.armed} rows={{ iris: o.config.cctp.IRIS_API, testnet: o.config.cctp.testnet }} />
            <div style={S.muted}>Limits: swap {money(o.config.limits.maxSwapUsd)} · cctp {money(o.config.limits.maxCctpUsd)}</div>
          </div>
        </div>

        {/* Security */}
        <div>
          <h2 style={S.h2}>Security events</h2>
          <div style={S.card}>
            {security.length === 0 ? <p style={S.muted}>No security events recorded.</p> : security.map((e) => (
              <div key={e.id} style={S.eventRow}>
                <span style={{ ...S.sev, ...sevColor(e.severity) }}>{e.severity.toUpperCase()}</span>
                <span style={S.mono}>{e.rail}</span>
                <span>{e.kind}</span>
                <span style={S.muted}>{new Date(e.ts).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Transactions */}
      <h2 style={S.h2}>Recent transactions</h2>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead><tr>{["Time", "Rail", "State", "Substate", "USD", "Tx hash"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {txs.length === 0 ? (
              <tr><td style={S.td} colSpan={6}><span style={S.muted}>No transactions recorded yet.</span></td></tr>
            ) : txs.map((t) => (
              <tr key={t.id}>
                <td style={S.td}>{new Date(t.ts).toLocaleTimeString()}</td>
                <td style={S.td}>{t.rail}</td>
                <td style={S.td}>{t.state}</td>
                <td style={S.td}>{t.substate ?? "—"}</td>
                <td style={S.td}>{t.amountUsd != null ? money(t.amountUsd) : "—"}</td>
                <td style={{ ...S.td, ...S.mono }}>{t.txHash ? `${t.txHash.slice(0, 10)}…${t.txHash.slice(-6)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={S.tile}>
      <div style={S.tileValue}>{value}</div>
      <div style={S.tileLabel}>{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const c: Record<string, React.CSSProperties> = {
    HEALTHY: { background: "#065f46", color: "#d1fae5" },
    PAUSED: { background: "#7c2d12", color: "#fed7aa" },
    DEGRADED: { background: "#78350f", color: "#fde68a" },
    INCIDENT: { background: "#7f1d1d", color: "#fecaca" },
    NOT_CONFIGURED: { background: "#374151", color: "#d1d5db" },
  };
  return <span style={{ ...S.badge, ...(c[status] ?? c.NOT_CONFIGURED) }}>{status}</span>;
}

function ConfigGroup({ title, armed, rows }: { title: string; armed: boolean; rows: Record<string, unknown> }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <b>{title}</b>
        <span style={{ ...S.badge, ...(armed ? { background: "#065f46", color: "#d1fae5" } : { background: "#374151", color: "#d1d5db" }) }}>
          {armed ? "ARMED" : "NOT ARMED"}
        </span>
      </div>
      {Object.entries(rows).filter(([k]) => k !== "armed").map(([k, v]) => (
        <div key={k} style={S.configRow}>
          <span style={S.muted}>{k}</span>
          <span style={S.mono}>{typeof v === "boolean" ? (v ? "CONFIGURED" : "MISSING") : v == null ? "—" : String(v)}</span>
        </div>
      ))}
    </div>
  );
}

function sevColor(sev: string): React.CSSProperties {
  return { critical: { color: "#fca5a5" }, high: { color: "#fca5a5" }, medium: { color: "#fcd34d" }, low: { color: "#93c5fd" }, info: { color: "#9ca3af" } }[sev] ?? { color: "#9ca3af" };
}

const S: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1200, margin: "0 auto", padding: "24px 20px", fontFamily: "ui-sans-serif, system-ui, sans-serif" },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  headerRight: { display: "flex", gap: 12, alignItems: "center" },
  h1: { fontSize: 24, fontWeight: 700, margin: 0 },
  h2: { fontSize: 16, fontWeight: 600, margin: "24px 0 10px" },
  muted: { color: "#6b7280", fontSize: 13 },
  mono: { fontFamily: "ui-monospace, monospace", fontSize: 12 },
  tiles: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 },
  tile: { border: "1px solid #2a2a2a", borderRadius: 10, padding: "14px 16px", background: "rgba(127,127,127,0.04)" },
  tileValue: { fontSize: 22, fontWeight: 700 },
  tileLabel: { fontSize: 12, color: "#6b7280", marginTop: 4 },
  tableWrap: { overflowX: "auto", border: "1px solid #2a2a2a", borderRadius: 10 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #2a2a2a", color: "#6b7280", fontWeight: 600, whiteSpace: "nowrap" },
  td: { padding: "9px 12px", borderBottom: "1px solid #1e1e1e", whiteSpace: "nowrap" },
  twoCol: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, marginTop: 8 },
  card: { border: "1px solid #2a2a2a", borderRadius: 10, padding: 16 },
  configRow: { display: "flex", justifyContent: "space-between", padding: "3px 0" },
  eventRow: { display: "grid", gridTemplateColumns: "70px 60px 1fr auto", gap: 8, alignItems: "center", padding: "5px 0", fontSize: 12, borderBottom: "1px solid #1e1e1e" },
  sev: { fontWeight: 700, fontSize: 11 },
  badge: { padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600 },
  btn: { padding: "8px 14px", borderRadius: 8, border: "1px solid #2a2a2a", cursor: "pointer", fontSize: 13, fontWeight: 600, background: "transparent", color: "inherit" },
  btnSm: { padding: "4px 10px", borderRadius: 6, border: "1px solid #2a2a2a", cursor: "pointer", fontSize: 12, background: "transparent", color: "inherit" },
  btnDanger: { borderColor: "#b91c1c", color: "#fca5a5" },
  btnResume: { borderColor: "#065f46", color: "#6ee7b7" },
};
