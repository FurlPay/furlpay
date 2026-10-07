"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Copy, ExternalLink, Repeat, X } from "lucide-react";
import type { FeedEvent, LiveSnapshot, TxDetail } from "@/lib/onchain/live";
import type { SectionFreshness } from "@/lib/onchain/freshness";
import { fmtUsd, relTime } from "@/components/analytics/format";
import { BrandLogo, chainName } from "./BrandLogo";

// ---------------------------------------------------------------------------
// The live layer of /onchain: one SSE connection (change notifications only),
// a refetch of /api/onchain/live on each change, polling as the fallback, and
// the components that show what came back. The badge reports the PIPELINE's
// real state (from the server) combined with this tab's connection state —
// it never says "live" just because the page is open.
// ---------------------------------------------------------------------------

export type ConnState = "connecting" | "open" | "reconnecting" | "polling";

export function useOnchainLive(onChange?: () => void) {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const lastSig = useRef<string | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/onchain/live", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { ok: true; data: LiveSnapshot } | null;
      if (!res.ok || !body?.ok) throw new Error(`live ${res.status}`);
      setSnap(body.data);
      setReceivedAt(Date.now());
      setError(null);
      // Any upstream change (ledger row, security event, chain event) also
      // refreshes the ledger-backed cards; an unchanged signature costs nothing.
      const sig = `${body.data.latestId ?? 0}|${body.data.dataVersion}`;
      if (lastSig.current !== undefined && sig !== lastSig.current) onChangeRef.current?.();
      lastSig.current = sig;
    } catch {
      setError("Live feed unreachable.");
    }
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let poll: number | undefined;
    let retry: number | undefined;
    let attempts = 0;
    let stopped = false;
    void load();
    const startPolling = () => {
      setConn("polling");
      window.clearInterval(poll);
      poll = window.setInterval(() => document.visibilityState === "visible" && void load(), 15_000);
    };
    const connect = () => {
      if (stopped || typeof EventSource === "undefined") return startPolling();
      es = new EventSource("/api/onchain/stream");
      es.addEventListener("open", () => {
        attempts = 0;
        setConn("open");
        window.clearInterval(poll);
      });
      es.addEventListener("change", () => void load());
      es.addEventListener("error", () => {
        // The server closes every 50 s by design; EventSource reconnects by
        // itself. Only a CLOSED source needs us — back off, then poll.
        if (es?.readyState === EventSource.CLOSED) {
          es.close();
          attempts++;
          setConn(attempts > 3 ? "polling" : "reconnecting");
          if (attempts > 3) startPolling();
          retry = window.setTimeout(connect, Math.min(30_000, 1_000 * 2 ** attempts + Math.random() * 500));
        } else setConn("reconnecting");
      });
    };
    connect();
    return () => {
      stopped = true;
      es?.close();
      window.clearInterval(poll);
      window.clearTimeout(retry);
    };
  }, [load]);

  return { snap, conn, error, receivedAt, reload: load };
}

const STATE_STYLE: Record<string, { text: string; cls: string; dot: string; pulse?: boolean }> = {
  live: { text: "Live Data", cls: "border-[#00E599]/45 text-[#00E599]", dot: "bg-[#00E599]", pulse: true },
  reconnecting: { text: "Reconnecting", cls: "border-[#F5B83D]/45 text-[#F5B83D]", dot: "bg-[#F5B83D]" },
  degraded: { text: "Degraded", cls: "border-[#F5B83D]/45 text-[#F5B83D]", dot: "bg-[#F5B83D]" },
  stale: { text: "Stale", cls: "border-[#F5B83D]/45 text-[#F5B83D]", dot: "bg-[#F5B83D]" },
  offline: { text: "Offline", cls: "border-[#FF4D6D]/45 text-[#FF8FA3]", dot: "bg-[#FF4D6D]" },
  not_configured: { text: "Allium not connected", cls: "border-white/20 text-white/70", dot: "bg-white/50" },
  connecting: { text: "Connecting…", cls: "border-white/20 text-white/70", dot: "bg-white/50" },
};

function ago(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return relTime(Date.now() - ms).replace(" ago", "");
}

/** The header badge: pipeline state x connection state, with the reason and freshness on hover/focus. */
export function LiveBadge({ snap, conn }: { snap: LiveSnapshot | null; conn: ConnState }) {
  const key = !snap ? "connecting" : snap.state === "live" && conn === "reconnecting" ? "reconnecting" : snap.state;
  const s = STATE_STYLE[key] ?? STATE_STYLE.offline;
  const f = snap?.freshness;
  return (
    <span className="group relative" tabIndex={0}>
      <span className={`flex h-[34px] items-center gap-2 rounded-lg border bg-[#00E599]/[0.04] px-4 text-[12.5px] font-medium ${s.cls}`} aria-live="polite">
        <span className={`h-2 w-2 rounded-full ${s.dot} ${s.pulse ? "animate-pulse" : ""}`} />
        {s.text}
      </span>
      <span role="tooltip" className="pointer-events-none absolute right-0 top-10 z-50 hidden w-[290px] rounded-lg border border-white/[0.12] bg-[#0D1415] p-3 text-[11.5px] text-white/75 shadow-xl shadow-black/60 group-hover:block group-focus:block">
        <span className="mb-1.5 block font-medium text-white">Onchain pipeline</span>
        {snap?.reason && <span className="mb-1.5 block text-[#F5B83D]">{snap.reason}</span>}
        <span className="flex justify-between">Last chain event <span className="text-white">{f?.lastBlockAt ? relTime(f.lastBlockAt) : "none yet"}</span></span>
        <span className="flex justify-between">Ingest lag (newest) <span className="text-white">{ago(f?.ingestLagMs ?? null)}</span></span>
        <span className="flex justify-between">Events stored <span className="text-white">{snap?.health ? snap.health.eventsTotal.toLocaleString("en-US") : "—"}</span></span>
        <span className="flex justify-between">Dead letters (24h) <span className="text-white">{snap?.health?.deadLetters24h ?? "—"}</span></span>
        <span className="flex justify-between">Last reconciliation <span className="text-white">{snap?.health?.lastRun ? `${snap.health.lastRun.status} · ${relTime(snap.health.lastRun.finishedAt ?? snap.health.lastRun.startedAt)}` : "never"}</span></span>
        {snap?.ingest1h?.allium_beam && (
          <>
            <span className="flex justify-between">Ingest lag 1h (avg / max) <span className="text-white">{ago(snap.ingest1h.allium_beam.lagMsAvg)} / {ago(snap.ingest1h.allium_beam.lagMsMax)}</span></span>
            <span className="flex justify-between">Webhook events 1h <span className="text-white">{snap.ingest1h.allium_beam.received} recv · {snap.ingest1h.allium_beam.duplicates} dup · {snap.ingest1h.allium_beam.reorgReplaced} reorg</span></span>
          </>
        )}
        {snap?.ingest1h?.node_rpc && (
          <span className="flex justify-between">Node events 1h <span className="text-white">{snap.ingest1h.node_rpc.received} recv · {snap.ingest1h.node_rpc.inserted} new · {snap.ingest1h.node_rpc.conflicts} conflict</span></span>
        )}
        <span className="flex justify-between">Browser link <span className="text-white">{conn === "open" ? "streaming" : conn}</span></span>
      </span>
    </span>
  );
}

const STATE_CHIP: Record<FeedEvent["state"], string> = {
  observed: "text-[#F5B83D] border-[#F5B83D]/30",
  confirmed: "text-[#3B82F6] border-[#3B82F6]/30",
  finalized: "text-[#00E599] border-[#00E599]/30",
  reorged: "text-[#FF4D6D] border-[#FF4D6D]/30 line-through",
};

export function StateChip({ state }: { state: FeedEvent["state"] }) {
  return <span className={`rounded border px-1.5 py-px text-[10px] capitalize ${STATE_CHIP[state]}`}>{state}</span>;
}

/** One chain event row (Real-time Activity, search results). */
export function ChainEventRow({ e, onOpen }: { e: FeedEvent; onOpen: (e: FeedEvent) => void }) {
  const Dir = e.direction === "in" ? ArrowDownLeft : e.direction === "out" ? ArrowUpRight : Repeat;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(e)}
        title={`${e.direction === "in" ? "Received from" : e.direction === "out" ? "Sent to" : "Moved between"} ${e.direction === "in" ? e.from : e.to}${e.amountUsd !== null ? ` · ${fmtUsd(e.amountUsd)}` : ""}`}
        className="grid w-full grid-cols-[26px_minmax(0,1fr)_auto_auto_56px] items-center gap-3 rounded-md px-1 py-[6px] text-left transition-colors hover:bg-white/[0.035] focus:bg-white/[0.05] focus:outline-none"
      >
        <span className="relative h-[22px] w-[22px]">
          <BrandLogo kind="token" id={e.asset} size={22} />
          <span className="absolute -bottom-1 -right-1.5 rounded-full bg-[#0A0F10] p-[1.5px]">
            <BrandLogo kind="chain" id={e.chain} size={11} />
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <Dir className={`h-3.5 w-3.5 shrink-0 ${e.direction === "in" ? "text-[#00E599]" : e.direction === "out" ? "text-[#FF8FA3]" : "text-white/50"}`} aria-label={e.direction} />
          <span className="truncate font-mono text-[12px] text-white/90">{e.hash}</span>
        </span>
        <StateChip state={e.state} />
        <span className="text-right tabular-nums text-white">
          {e.amount !== null ? `${Number(e.amount).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${e.asset ?? ""}` : "—"}
        </span>
        <span className="whitespace-nowrap text-right text-white/50">{relTime(e.at)}</span>
      </button>
    </li>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1200);
        });
      }}
      className="rounded p-1 text-white/50 hover:bg-white/[0.06] hover:text-white"
    >
      {done ? <Check className="h-3.5 w-3.5 text-[#00E599]" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Transaction inspector. Public viewers of a user's event see only what the feed shows. */
export function TxDrawer({ ev, onClose }: { ev: FeedEvent; onClose: () => void }) {
  const [detail, setDetail] = useState<TxDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!ev.hashFull) return;
    const ac = new AbortController();
    fetch(`/api/onchain/tx?key=${encodeURIComponent(ev.key)}`, { signal: ac.signal, cache: "no-store" })
      .then(async (r) => {
        const b = (await r.json().catch(() => null)) as { ok: true; data: TxDetail } | { ok: false; error?: { message?: string } } | null;
        if (b && b.ok) setDetail(b.data);
        else setErr((b && !b.ok && b.error?.message) || `Request failed (${r.status})`);
      })
      .catch((e) => (e as Error).name !== "AbortError" && setErr("Network error."));
    const key = (k: KeyboardEvent) => k.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => {
      ac.abort();
      window.removeEventListener("keydown", key);
    };
  }, [ev, onClose]);
  const e = detail?.event ?? ev;
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-white/[0.05] py-2 text-[12.5px]">
      <span className="text-white/50">{label}</span>
      <span className="min-w-0 break-all text-white/90">{value}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Transaction detail">
      <button aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 w-full max-w-[460px] overflow-y-auto border-l border-white/[0.1] bg-[#0A0F10] p-5">
        <div className="mb-4 flex items-center gap-2">
          <BrandLogo kind="token" id={e.asset} size={22} />
          <h2 className="text-[16px] font-semibold">Transaction</h2>
          <StateChip state={e.state} />
          <button onClick={onClose} aria-label="Close" className="ml-auto rounded p-1.5 text-white/60 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        {!ev.hashFull && <p className="mb-3 rounded-md border border-white/[0.1] bg-white/[0.02] px-3 py-2 text-[12px] text-white/60">This is a FurlPay user&apos;s wallet activity. Public viewers see it truncated; full detail is limited to operators.</p>}
        {err && <p className="mb-3 text-[12px] text-[#FF8FA3]">{err}</p>}
        {row(
          "Hash",
          <span className="flex items-center gap-1 font-mono text-[11.5px]">
            {e.hashFull ?? e.hash}
            {e.hashFull && <CopyButton value={e.hashFull} label="transaction hash" />}
          </span>
        )}
        {row(
          "Chain",
          <span className="flex items-center gap-1.5">
            <BrandLogo kind="chain" id={e.chain} size={15} /> {chainName(e.chain)}
          </span>
        )}
        {row("Block", e.blockNumber?.toLocaleString("en-US") ?? "—")}
        {detail?.blockHash && row("Block hash", <span className="font-mono text-[11px]">{detail.blockHash}</span>)}
        {row("Timestamp", `${new Date(e.at).toUTCString()} (${relTime(e.at)})`)}
        {row("Confirmation", <StateChip state={e.state} />)}
        {row("Activity", <span className="capitalize">{e.activity}</span>)}
        {row("From", <span className="font-mono text-[11.5px]">{e.from}</span>)}
        {row("To", <span className="font-mono text-[11.5px]">{e.to}</span>)}
        {row("Amount", e.amount !== null ? `${e.amount} ${e.asset ?? ""}` : "—")}
        {row("USD value", e.amountUsd !== null ? `${fmtUsd(e.amountUsd)} (provider-reported)` : "—")}
        {detail?.assetAddress && row("Asset contract", <span className="font-mono text-[11px]">{detail.assetAddress}</span>)}
        {row("Counterparty", "Unknown address (no verified entity label)")}
        {detail?.ledger && row("FurlPay ledger", detail.ledger.reconciliationRequired ? <span className="text-[#F5B83D]">Reconciliation required — {detail.ledger.note}</span> : detail.ledger.ref ?? "No ledger reference")}
        {detail?.revisions && detail.revisions.length > 0 && row("History", <ul className="space-y-0.5">{detail.revisions.map((r, i) => <li key={i} className="text-white/70">{r.change} · {relTime(r.at)}{r.reason ? ` — ${r.reason}` : ""}</li>)}</ul>)}
        {detail && detail.related.length > 0 && row("Same transaction", <ul className="space-y-0.5">{detail.related.map((r) => <li key={r.key} className="text-white/70">{r.amount ?? "—"} {r.asset ?? ""} · {r.activity}</li>)}</ul>)}
        <div className="mt-4 flex flex-wrap gap-2">
          {detail?.explorer.tx && (
            <a href={detail.explorer.tx} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-md border border-white/[0.12] px-3 py-1.5 text-[12px] hover:bg-white/[0.05]">
              Block explorer <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {detail?.explorer.from && (
            <a href={detail.explorer.from} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-md border border-white/[0.12] px-3 py-1.5 text-[12px] hover:bg-white/[0.05]">
              Sender wallet <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {detail?.explorer.to && (
            <a href={detail.explorer.to} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-md border border-white/[0.12] px-3 py-1.5 text-[12px] hover:bg-white/[0.05]">
              Recipient wallet <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </aside>
    </div>
  );
}

/** The chain feed's pipeline state on the dashboard-wide freshness scale. */
export function liveFreshness(s: LiveSnapshot): SectionFreshness {
  const state: SectionFreshness["state"] =
    s.state === "live" ? "live" : s.state === "degraded" ? "delayed" : s.state === "not_configured" ? "not_connected" : s.state;
  return {
    state,
    source: "Allium Beam webhook + Realtime API reconciliation",
    asOf: s.freshness.lastBlockAt,
    cadence: "event-driven (Beam P50 ~1-2 s per Allium; measured lag in the badge)",
    reason: s.reason ?? undefined,
  };
}
