"use client";

import { useState } from "react";
import { RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import type { UsdcChain, UsdcWindow } from "@/lib/onchain/usdcNetwork";
import type { HistoryRange } from "@/lib/onchain/usdcHistory";
import { BrandLogo, chainName } from "./BrandLogo";
import { Address, explorerUrl } from "./Address";
import { Card, Unavailable } from "./ui";
import { useTick, useUsdcHistory, useUsdcLive } from "./usdcPanel/hooks";
import { ChainTable } from "./usdcPanel/ChainTable";
import { HistoryChart, Rankings } from "./usdcPanel/History";
import { ago, Def, DEFINITIONS, Flash, int, Segmented, usdc } from "./usdcPanel/parts";

// ---------------------------------------------------------------------------
// USDC Network — the first-class asset on /onchain. Two sources, labelled as
// such everywhere:
//   LIVE     each chain's node, read every 10 s (/api/onchain/usdc): head,
//            exact supply, and every USDC Transfer in the last 1 or 5 minutes.
//   HISTORY  the stored network index (/api/onchain/usdc/history): finalized
//            blocks only, aggregated server-side, with per-chain coverage.
// Unit is USDC everywhere — nothing is priced. A chain that is not configured,
// not reachable or not indexed says so; it is never shown as zero.
// ---------------------------------------------------------------------------

const txUrl = (c: UsdcChain, tx: string) => (c.explorer ? `${c.explorer.replace(/\/+$/, "").split("?")[0]}/tx/${tx}` : null);

function Metric({ k, label, value, exact, sub, tone }: { k: string; label: string; value: string; exact?: string | null; sub: string; tone?: "pos" | "neg" }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-white/55">
        <Def k={k}>{label}</Def>
      </p>
      <p className={`truncate text-[17px] font-bold tabular-nums leading-tight ${tone === "pos" ? "text-[#00E599]" : tone === "neg" ? "text-[#FF8FA3]" : ""}`} title={exact ?? undefined}>
        <Flash value={value}>{value}</Flash>
      </p>
      <p className="truncate text-[10.5px] text-white/40">{sub}</p>
    </div>
  );
}

export function UsdcNetworkPanel() {
  const [win, setWin] = useState<UsdcWindow>(60);
  const [range, setRange] = useState<HistoryRange>("24h");
  const live = useUsdcLive(win);
  const hist = useUsdcHistory(range);
  useTick(5_000);
  const data = live.data;
  const T = data?.totals;
  const winLabel = win === 60 ? "last 1 min" : "last 5 min";
  const net = T ? Number(T.netSupplyChange) : 0;
  /** At least one chain actually read live activity; otherwise activity metrics are unavailable, not zero. */
  const act = Boolean(T && T.windowChains.length > 0);
  const noAct = "no chain reads live activity";
  const states = data ? Object.values(data.health) : [];
  const liveCount = states.filter((s) => s.state === "LIVE").length;
  const issues = data ? data.chains.flatMap((c) => (data.health[c.chain]?.issues ?? []).map((i) => ({ ...i, chain: c.chain }))) : [];
  const largest = data
    ? data.chains
        .flatMap((c) => (c.window?.largest ?? []).map((t) => ({ ...t, c })))
        .sort((a, b) => Number(b.amount) - Number(a.amount))
        .slice(0, 6)
    : [];
  const H = hist.data;

  return (
    <Card
      id="usdc"
      title="USDC Network"
      source="Each chain's own node (JSON-RPC), read live; history from FurlPay's stored network index (finalized blocks). Native Circle USDC only."
      action={
        <>
          <span className="hidden items-center gap-1.5 text-[11px] text-white/50 sm:flex" aria-live="polite">
            <span className={`h-1.5 w-1.5 rounded-full ${live.error ? "bg-[#F5B83D]" : data ? "bg-[#00E599] motion-safe:animate-pulse" : "bg-white/30"}`} aria-hidden="true" />
            {live.error && data ? "Delayed · " : ""}
            {/* The server's node read time, not when this browser fetched it (reads are shared and cached). */}
            Node read {ago(data?.generatedAt ?? null)}
          </span>
          <span className="rounded border border-white/[0.12] px-1.5 py-0.5 text-[10.5px] font-semibold text-white/70" title="Every amount on this panel is in USDC units, not converted to USD.">
            Unit: USDC
          </span>
          <Segmented label="Live window" value={String(win) as "60" | "300"} onChange={(v) => setWin(Number(v) as UsdcWindow)} options={[{ v: "60", l: "1m" }, { v: "300", l: "5m" }]} />
          <button type="button" onClick={() => void live.reload()} aria-label="Refresh USDC" className="rounded-md border border-white/[0.12] p-1.5 text-white/70 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#00E599]">
            <RefreshCw className={`h-3.5 w-3.5 ${live.loading ? "motion-safe:animate-spin" : ""}`} />
          </button>
        </>
      }
    >
      {live.error && (
        <p role="alert" className="mb-2 rounded-md border border-[#F5B83D]/30 bg-[#F5B83D]/[0.06] px-2.5 py-1.5 text-[11.5px] text-[#F5D58A]">
          Live read failed: {live.error}
          {data ? ` Showing the read from ${ago(live.lastOk)}.` : ""}
        </p>
      )}
      {!data ? (
        live.error ? (
          <Unavailable reason="USDC could not be read from the chain nodes." />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-4 xl:grid-cols-8" aria-busy="true" aria-label="Loading USDC">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-[58px] animate-pulse rounded-[9px] border border-white/[0.06] bg-white/[0.02]" />
            ))}
          </div>
        )
      ) : T!.supplyChains.length === 0 ? (
        <Unavailable reason={`No chain node is configured or reachable for USDC. ${data.chains.map((c) => `${chainName(c.chain)}: ${c.reason}`).join(" ")}`} />
      ) : (
        <>
          {/* Live summary */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-white/[0.06] pb-3 sm:grid-cols-4 xl:grid-cols-8">
            <Metric k="supply" label="Native USDC supply" value={usdc(T!.supply)} exact={T!.supply} sub={`${T!.supplyChains.length} chains · exact`} />
            {/* No chain read live activity -> these are UNAVAILABLE, never 0. */}
            <Metric k="netSupply" label="Net supply change" value={act ? usdc(T!.netSupplyChange, { sign: true }) : "Unavailable"} exact={act ? T!.netSupplyChange : null} sub={act ? winLabel : noAct} tone={act && net > 0 ? "pos" : act && net < 0 ? "neg" : undefined} />
            <Metric k="volume" label="Transfer volume" value={act ? usdc(T!.volume) : "Unavailable"} exact={act ? T!.volume : null} sub={act ? `${winLabel} · excl. mint/burn` : noAct} />
            <Metric k="transfers" label="Transfers" value={act ? int(T!.transfers) : "Unavailable"} sub={act ? winLabel : noAct} />
            <Metric k="minted" label="Minted" value={act ? usdc(T!.mintVolume) : "Unavailable"} exact={act ? T!.mintVolume : null} sub={act ? winLabel : noAct} />
            <Metric k="burned" label="Burned" value={act ? usdc(T!.burnVolume) : "Unavailable"} exact={act ? T!.burnVolume : null} sub={act ? winLabel : noAct} />
            <Metric k="senders" label="Unique senders" value={act ? int(T!.uniqueSenders) : "Unavailable"} sub={act ? `${int(T!.uniqueRecipients)} receivers · per chain` : noAct} />
            <Metric k="eps" label="Events / sec" value={act && T!.eventsPerSecond !== null ? T!.eventsPerSecond.toFixed(1) : "Unavailable"} sub={`${T!.windowChains.length} ${T!.windowChains.length === 1 ? "chain" : "chains"} · ${liveCount}/${data.chains.length} live`} />
          </div>
          {T!.windowChains.length < T!.supplyChains.length && (
            <p className="mt-2 text-[11px] text-white/45">
              Live activity covers {T!.windowChains.map(chainName).join(", ") || "no chain"}.{" "}
              {(() => {
                const off = data.chains.filter((c) => c.chain !== "solana" && c.status === "ok" && !c.window);
                return off.length ? `${off.map((c) => chainName(c.chain)).join(", ")}: live window off; scanning their logs on every page view would exhaust the RPC plan (Alchemy Free: 10-block eth_getLogs, 30M CU/month), so their activity comes from the indexer.` : "";
              })()}{" "}
              Solana: supply, slots and tracked wallets are indexed from the node; network-wide Solana transfer enumeration requires a Geyser streaming source and is not counted.
            </p>
          )}

          {/* Cross-chain */}
          <h3 className="mb-1.5 mt-4 text-[12.5px] font-semibold text-white/85">Chains</h3>
          {!data.index.available && data.index.reason && (
            <p className="mb-2 rounded-md border border-[#F5B83D]/25 bg-[#F5B83D]/[0.05] px-2.5 py-1.5 text-[11.5px] text-[#F5D58A]">
              Live node reads only on every chain: {data.index.reason} Indexed block, lag, processing time and history need it.
            </p>
          )}
          <ChainTable data={data} winLabel={winLabel} />

          {/* History + rankings */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <h3 className="text-[12.5px] font-semibold text-white/85">History · finalized index</h3>
            <Segmented
              label="History range"
              value={range}
              onChange={setRange}
              options={(["1h", "24h", "7d", "30d", "90d", "all"] as const).map((r) => ({ v: r, l: r.toUpperCase() }))}
            />
            {H && <span className="text-[11px] text-white/45">per {H.bucket} · updated {ago(hist.lastOk)}</span>}
          </div>
          {hist.error && !H && <p className="mt-2 text-[11.5px] text-[#F5D58A]">History unavailable: {hist.error}</p>}
          {!H ? (
            !hist.error && <div className="mt-2 h-[150px] animate-pulse rounded-lg border border-white/[0.06] bg-white/[0.02]" aria-busy="true" aria-label="Loading history" />
          ) : !H.available ? (
            <p className="mt-2 rounded-lg border border-dashed border-white/[0.09] px-3 py-3 text-[11.5px] text-white/55">History not available: {H.reason}</p>
          ) : (
            <>
              {H.totals && (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                  <Metric k="volume" label="Transfer volume" value={usdc(H.totals.volume)} exact={H.totals.volume} sub={`${range.toUpperCase()} · ${H.totals.chains.length} chains`} />
                  <Metric k="transfers" label="Transfers" value={int(H.totals.transfers)} sub={range.toUpperCase()} />
                  <Metric k="minted" label="Minted" value={usdc(H.totals.minted)} exact={H.totals.minted} sub={range.toUpperCase()} />
                  <Metric k="burned" label="Burned" value={usdc(H.totals.burned)} exact={H.totals.burned} sub={range.toUpperCase()} />
                </div>
              )}
              <div className="mt-3">
                <HistoryChart h={H} />
              </div>
            </>
          )}
          <h3 className="mb-2 mt-4 text-[12.5px] font-semibold text-white/85">Cross-chain ranking · {range.toUpperCase()}</h3>
          {H && !H.available ? (
            <p className="text-[11.5px] text-white/50">Rankings need the stored index: {H.reason}</p>
          ) : (
            <Rankings h={H && H.available ? H : null} live={data} />
          )}

          {/* Integrity */}
          <div className="mt-4 rounded-lg border border-white/[0.07] px-3 py-2.5">
            {!data.index.available ? (
              <p className="flex items-start gap-2 text-[11.5px] text-white/60">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F5B83D]" aria-hidden="true" />
                <span>Integrity checks unavailable: {data.index.reason} They run on every indexed range once the index is stored.</span>
              </p>
            ) : issues.length === 0 ? (
              <p className="flex items-start gap-2 text-[11.5px] text-white/65">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#00E599]" aria-hidden="true" />
                <span>
                  No open integrity issues. Checked on every indexed range: contiguous blocks, unchanged finalized parent, exact supply reconciliation, no negative or impossible amounts, no duplicate events, endpoint chain id.
                </span>
              </p>
            ) : (
              <>
                <p className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold text-[#F5B83D]">
                  <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /> {issues.length} open integrity issue{issues.length === 1 ? "" : "s"}
                </p>
                <ul className="space-y-1 text-[11px]">
                  {issues.slice(0, 8).map((i) => (
                    <li key={`${i.chain}:${i.kind}:${i.block}`} className="text-white/70">
                      <span className="font-semibold text-white">{chainName(i.chain)}</span> · {i.kind.replace(/_/g, " ")}
                      {i.block !== null ? ` at #${int(Number(i.block))}` : ""} · {i.detail} <span className="text-white/40">({i.occurrences}×, last {ago(i.last_seen)})</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* Largest live transfers */}
          <h3 className="mb-1.5 mt-4 text-[12.5px] font-semibold text-white/85">Largest USDC transfers · {winLabel}</h3>
          {largest.length === 0 ? (
            <p className="text-[11.5px] text-white/45">No USDC transfers were read in this window.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-[11.5px] tabular-nums">
                <caption className="sr-only">Largest native USDC transfers in the {winLabel}, read from chain nodes</caption>
                <thead>
                  <tr className="text-left text-white/45">
                    <th scope="col" className="py-1 font-medium">Chain</th>
                    <th scope="col" className="py-1 font-medium">Block</th>
                    <th scope="col" className="py-1 font-medium">From</th>
                    <th scope="col" className="py-1 font-medium">To</th>
                    <th scope="col" className="py-1 text-right font-medium">Amount (USDC)</th>
                    <th scope="col" className="py-1 text-right font-medium">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {largest.map((t) => {
                    const href = txUrl(t.c, t.txHash);
                    return (
                      <tr key={`${t.c.chain}:${t.txHash}:${t.from}:${t.amount}`} className="border-t border-white/[0.05]">
                        <td className="py-1.5">
                          <span className="flex items-center gap-1.5">
                            <BrandLogo kind="chain" id={t.c.chain} size={14} />
                            {chainName(t.c.chain)}
                          </span>
                        </td>
                        <td className="py-1.5 text-white/70">#{int(t.block)}</td>
                        <td className="max-w-[210px] py-1.5 pr-2 align-top">
                          <Address value={t.from} href={explorerUrl(t.c.explorer, "address", t.from)} label="sender address" />
                        </td>
                        <td className="max-w-[210px] py-1.5 pr-2 align-top">
                          <Address value={t.to} href={explorerUrl(t.c.explorer, "address", t.to)} label="recipient address" />
                        </td>
                        <td className="py-1.5 pr-2 text-right align-top font-semibold">{usdc(t.amount, { compact: false })}</td>
                        <td className="max-w-[260px] py-1.5 align-top">
                          <Address value={t.txHash} href={href} label="transaction hash" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Exclusions + definitions */}
          <div className="mt-3 space-y-1 text-[10.5px] text-white/40">
            {data.excluded.map((e) => (
              <p key={e.symbol}>
                <span className="font-semibold text-white/60">Excluded: {e.symbol}</span> ({Object.entries(e.contracts).map(([c, a]) => `${chainName(c)} ${a}`).join(", ")}). {e.reason}
              </p>
            ))}
            <details className="group">
              <summary className="cursor-pointer select-none text-white/55 hover:text-white/80">Definitions</summary>
              <dl className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {Object.entries(DEFINITIONS).map(([k, v]) => (
                  <div key={k}>
                    <dt className="inline font-semibold text-white/60">{k}: </dt>
                    <dd className="inline">{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <p>Live read at {new Date(data.generatedAt).toLocaleTimeString("en-US", { timeZone: "UTC", hour12: false })} UTC from each chain&apos;s node. Amounts are USDC units, never priced.</p>
          </div>
        </>
      )}
    </Card>
  );
}
