"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import type { OnchainDashboard as Data } from "@/lib/onchain/dashboard";
import { exportCsv, exportJson, systemStatus, volumeLayers, type SystemStatus } from "@/lib/onchain/dashboardView";
import { fmtUsd } from "@/components/analytics/format";
import { Card } from "./ui";

// ---------------------------------------------------------------------------
// Header controls and the volume-layer card. Everything here renders what the
// page already loaded: the status pill reads data.freshness, the export writes
// the same payload to a file, and the layer card shows each volume measure
// next to the others without adding them up.
// ---------------------------------------------------------------------------

const DOT: Record<SystemStatus["level"], string> = {
  operational: "bg-[#00E599]",
  degraded: "bg-[#F5B83D]",
  offline: "bg-[#FF4D6D]",
};
const STATE_TONE: Record<string, string> = {
  live: "text-[#00E599]",
  updating: "text-[#00E599]",
  delayed: "text-[#7DD3FC]",
  stale: "text-[#F5B83D]",
  offline: "text-[#FF4D6D]",
  not_connected: "text-white/45",
};

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

export function SystemStatusPill({ data }: { data: Data }) {
  const s = systemStatus(data.freshness);
  const { open, setOpen, ref } = usePopover();
  const updated = new Date(data.generatedAt).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.02] px-3 py-1.5 text-left hover:border-white/[0.2]"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[s.level]}`} aria-hidden="true" />
        <span>
          <span className="block text-[12.5px] font-medium text-white">{s.label}</span>
          <span className="block text-[10.5px] text-white/50">Updated {updated} UTC</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-white/50" />
      </button>
      {open && (
        <div role="dialog" aria-label="Data sources" className="absolute right-0 z-50 mt-1 w-[320px] max-w-[calc(100vw-32px)] rounded-lg border border-white/[0.12] bg-[#0D1415] p-3 text-[12px] shadow-xl shadow-black/60">
          <p className="mb-2 font-medium text-white">Data sources</p>
          <ul className="space-y-1.5">
            {s.sections.map((x) => (
              <li key={x.key} className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-white/85">{x.label}</span>
                  <span className="block text-[10.5px] text-white/45">
                    {x.cadence}
                    {x.reason ? ` · ${x.reason}` : ""}
                  </span>
                </span>
                <span className={`shrink-0 text-[11px] capitalize ${STATE_TONE[x.state] ?? "text-white/60"}`}>{x.state.replace("_", " ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ExportMenu({ data }: { data: Data }) {
  const { open, setOpen, ref } = usePopover();
  const stem = `furlpay-onchain-${data.range.key}-${data.chain}-${data.generatedAt.slice(0, 10)}`;
  const item = "block w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-white/85 hover:bg-white/[0.06] hover:text-white";
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-[38px] items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.02] px-3 text-[12.5px] text-white/90 hover:border-white/[0.2]"
      >
        <Download className="h-3.5 w-3.5" /> Export <ChevronDown className="h-3.5 w-3.5 text-white/50" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-1 w-[200px] rounded-lg border border-white/[0.12] bg-[#0D1415] p-1 shadow-xl shadow-black/60">
          <button role="menuitem" className={item} onClick={() => (download(`${stem}.csv`, "text/csv;charset=utf-8", exportCsv(data)), setOpen(false))}>
            CSV (current view)
          </button>
          <button role="menuitem" className={item} onClick={() => (download(`${stem}.json`, "application/json", exportJson(data)), setOpen(false))}>
            JSON (with sources)
          </button>
          <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] text-white/40">Exports what this page shows for the selected range and chain.</p>
        </div>
      )}
    </div>
  );
}

const LAYER_TONE: Record<string, string> = { raw: "#3B82F6", adjusted: "#A855F7", ledger: "#14B8A6" };

export function VolumeLayers({ data }: { data: Data }) {
  const layers = volumeLayers(data);
  return (
    <Card title="Transaction Volume — Layered View" id="volume-layers" source="Allium (raw), FurlPay ledger">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {layers.map((l) => (
          <div key={l.key} className="rounded-lg border border-white/[0.07] bg-white/[0.015] px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[12px] text-white/70">
              <span className="h-2 w-2 rounded-full" style={{ background: LAYER_TONE[l.key] }} aria-hidden="true" />
              {l.label}
            </p>
            {l.value === null ? (
              <p className="mt-1 text-[12px] leading-snug text-white/45">{l.unavailable}</p>
            ) : (
              <>
                <p className="mt-0.5 text-[21px] font-semibold tabular-nums tracking-[-0.01em] text-white">{fmtUsd(l.value)}</p>
                <p className="text-[10.5px] text-white/45">{l.window}</p>
              </>
            )}
            <p className="mt-1 text-[10.5px] leading-snug text-white/40">{l.measures}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10.5px] text-white/40">
        Each layer counts something different over its own window. They are shown side by side and never added together.
      </p>
    </Card>
  );
}
