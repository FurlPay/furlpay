"use client";

import { IconCrossChain, IconLink } from "@/components/furlicons";
import { ArrowRight, Check, Circle } from "lucide-react";
import type { CctpTransferView, CctpView } from "@/lib/onchain/cctpView";
import { BrandLogo, chainName } from "./BrandLogo";
import { domainName } from "@/lib/onchain/cctpDomains";
import { Card, Unavailable } from "./ui";
import { usePolled, useTick } from "./usdcPanel/hooks";
import { ago, int, usdc } from "./usdcPanel/parts";
import { Address } from "./Address";

// ---------------------------------------------------------------------------
// Cross-chain USDC via Circle CCTP V2, from FurlPay's index (finalized blocks;
// lib/onchain/cctp.ts). One row = one transfer, with four independent checks:
//   Source       the burn is in a finalized block FurlPay indexed
//   Attestation  Circle's Iris message matches the burn field-for-field
//   Destination  the destination chain itself shows the mint (indexed mint
//                event, or usedNonces(nonce)=1 at its finalized block)
//   Final        both legs are final
// A transfer is "Completed" only when the destination check passed.
// ---------------------------------------------------------------------------

const STATUS: Record<string, { label: string; cls: string }> = {
  burn_confirmed: { label: "Burned · awaiting attestation", cls: "border-white/15 text-white/70" },
  attestation_pending: { label: "Attestation pending", cls: "border-[#38BDF8]/35 text-[#7DD3FC]" },
  attestation_complete: { label: "Attested · destination unverified", cls: "border-[#F5B83D]/35 text-[#F5B83D]" },
  destination_verified: { label: "Destination verified", cls: "border-[#00E599]/35 text-[#00E599]" },
  finalized: { label: "Completed · verified", cls: "border-[#00E599]/35 bg-[#00E599]/[0.06] text-[#00E599]" },
  mismatch: { label: "Mismatch", cls: "border-[#FF4D6D]/35 text-[#FF8FA3]" },
};

function ChainLabel({ chain, domain }: { chain: string | null; domain: number | null }) {
  if (!chain) {
    // Not a chain FurlPay reads: Circle's official name, and the domain number (nothing verified there).
    const name = domainName(domain);
    return (
      <span className="text-white/60" title={domain === null ? undefined : `CCTP domain ${domain} — not read by FurlPay`}>
        {domain === null ? "—" : name ? `${name} (${domain})` : `CCTP domain ${domain}`}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <BrandLogo kind="chain" id={chain} size={13} />
      {chainName(chain)}
    </span>
  );
}

function Checks({ t }: { t: CctpTransferView }) {
  const items: [string, boolean, string][] = [
    ["Source", t.checks.source, t.checks.source ? "Burn read from a finalized block" : "Source leg not indexed by FurlPay"],
    ["Attestation", t.checks.attestation, t.checks.attestation ? `Circle message ${t.nonce ?? ""} matched exactly` : "No matching Circle attestation yet"],
    ["Destination", t.checks.destination, t.checks.destination ? (t.destinationMethod === "used_nonce" ? "usedNonces=1 at the destination's finalized block" : "Mint event indexed on the destination") : t.statusReason ?? "Not verified"],
    ["Final", t.checks.finality, t.checks.finality ? "Both legs final" : "Not final"],
  ];
  return (
    <span className="flex flex-wrap gap-1">
      {items.map(([l, ok, why]) => (
        <span key={l} title={why} className={`inline-flex items-center gap-0.5 rounded border px-1 text-[10px] ${ok ? "border-[#00E599]/30 text-[#00E599]" : "border-white/12 text-white/40"}`}>
          {ok ? <Check className="h-2.5 w-2.5" aria-hidden="true" /> : <Circle className="h-2 w-2" aria-hidden="true" />}
          {l}
          <span className="sr-only">{ok ? "verified" : "not verified"}</span>
        </span>
      ))}
    </span>
  );
}

export function CctpPanel() {
  const { data, error, lastOk } = usePolled<CctpView>("/api/onchain/cctp", 30_000);
  useTick(5_000);
  return <CctpPanelView data={data} error={error} lastOk={lastOk} />;
}

/** Pure view of /api/onchain/cctp (rendered server-side in the live acceptance test). */
export function CctpPanelView({ data, error, lastOk }: { data: CctpView | null; error: string | null; lastOk: number | null }) {
  const total = data ? Object.values(data.byStatus).reduce((a, b) => a + b, 0) : 0;
  return (
    <Card icon={IconCrossChain}
      id="cctp"
      title="Cross-chain USDC · Circle CCTP V2"
      source="FurlPay's index of CCTP V2 events from finalized blocks (TokenMessengerV2 / MessageTransmitterV2), Circle Iris attestations, and destination-chain verification."
      action={<span className="text-[11px] text-white/45">{data?.available ? `Index read ${ago(data.generatedAt)}` : lastOk ? `Updated ${ago(lastOk)}` : ""}</span>}
    >
      {error && !data && <Unavailable reason={`CCTP data could not be read: ${error}`} />}
      {!data ? (
        !error && <div className="h-[120px] animate-pulse rounded-lg border border-white/[0.06] bg-white/[0.02]" aria-busy="true" aria-label="Loading CCTP" />
      ) : !data.available ? (
        <Unavailable reason={data.reason ?? "Unavailable."} icon={IconLink} />
      ) : (
        <>
          <p className="mb-2 text-[11px] text-white/50">
            Indexed source/destination chains:{" "}
            {data.indexedChains.length ? data.indexedChains.map((c) => `${chainName(c.chain)} through #${int(c.through)} (${ago(c.throughTime)}, finalized)`).join(" · ") : "none yet"}. Last 24 h: {int(total)} transfers
            {data.completionSeconds.median !== null ? ` · median burn→mint ${data.completionSeconds.median}s (${data.completionSeconds.n} both-legs-indexed)` : ""}.
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {Object.entries(STATUS).map(([k, s]) =>
              data.byStatus[k] ? (
                <span key={k} className={`rounded-full border px-2 py-0.5 text-[10.5px] ${s.cls}`}>
                  {s.label}: {int(data.byStatus[k])}
                </span>
              ) : null
            )}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="min-w-0">
              <h3 className="mb-1 text-[12px] font-semibold text-white/80">Outbound · 24 h (burned on an indexed chain)</h3>
              {data.outbound.length === 0 ? (
                <p className="text-[11px] text-white/45">No outbound CCTP transfers indexed in the last 24 h.</p>
              ) : (
                <table className="w-full text-[11.5px] tabular-nums">
                  <tbody>
                    {data.outbound.slice(0, 8).map((o) => (
                      <tr key={`${o.sourceChain}:${o.destinationDomain}`} className="border-t border-white/[0.05]">
                        <td className="py-1">
                          <span className="inline-flex items-center gap-1.5">
                            <ChainLabel chain={o.sourceChain} domain={null} />
                            <ArrowRight className="h-3 w-3 text-white/35" aria-label="to" />
                            <ChainLabel chain={o.destinationChain} domain={o.destinationDomain} />
                          </span>
                        </td>
                        <td className="py-1 text-right" title={o.amount}>
                          {usdc(o.amount)} USDC
                        </td>
                        <td className="py-1 text-right text-white/50">{int(o.transfers)} tx</td>
                        <td className="py-1 text-right text-white/50" title="destination verified on its own chain">
                          {int(o.verified)} verified
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="min-w-0">
              <h3 className="mb-1 text-[12px] font-semibold text-white/80">Inbound · 24 h (minted on an indexed chain)</h3>
              {data.inbound.length === 0 ? (
                <p className="text-[11px] text-white/45">No inbound CCTP mints indexed in the last 24 h.</p>
              ) : (
                <table className="w-full text-[11.5px] tabular-nums">
                  <tbody>
                    {data.inbound.slice(0, 8).map((i) => (
                      <tr key={`${i.destinationChain}:${i.sourceDomain}`} className="border-t border-white/[0.05]">
                        <td className="py-1">
                          <span className="inline-flex items-center gap-1.5">
                            <ChainLabel chain={i.sourceChain} domain={i.sourceDomain} />
                            <ArrowRight className="h-3 w-3 text-white/35" aria-label="to" />
                            <ChainLabel chain={i.destinationChain} domain={null} />
                          </span>
                        </td>
                        <td className="py-1 text-right" title={i.minted}>
                          {usdc(i.minted)} USDC
                        </td>
                        <td className="py-1 text-right text-white/50">{int(i.transfers)} tx</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <h3 className="mb-1 mt-4 text-[12px] font-semibold text-white/80">Latest transfers</h3>
          {data.recent.length === 0 ? (
            <p className="text-[11px] text-white/45">No CCTP transfers indexed yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1320px] text-[11.5px] tabular-nums">
                <caption className="sr-only">Latest Circle CCTP V2 USDC transfers indexed by FurlPay, with verification checks</caption>
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-white/45">
                    <th scope="col" className="py-1 font-medium">Route</th>
                    <th scope="col" className="py-1 text-right font-medium">Amount (USDC)</th>
                    <th scope="col" className="py-1 font-medium">Status</th>
                    <th scope="col" className="py-1 font-medium">Checks</th>
                    <th scope="col" className="py-1 font-medium">Recipient</th>
                    <th scope="col" className="py-1 font-medium">Burn tx</th>
                    <th scope="col" className="py-1 font-medium">Mint tx</th>
                    <th scope="col" className="py-1 text-right font-medium">Burned</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((t) => {
                    const s = STATUS[t.status] ?? { label: t.status, cls: "border-white/15 text-white/60" };
                    return (
                      <tr key={t.id} className="border-t border-white/[0.05] align-top">
                        <td className="py-1.5">
                          <span className="inline-flex items-center gap-1.5">
                            <ChainLabel chain={t.sourceChain} domain={t.sourceDomain} />
                            <ArrowRight className="h-3 w-3 text-white/35" aria-label="to" />
                            <ChainLabel chain={t.destinationChain} domain={t.destinationDomain} />
                          </span>
                        </td>
                        <td className="py-1.5 text-right font-semibold" title={`burned ${t.amount ?? "?"}; minted ${t.minted ?? "not yet observed"}; fee ${t.fee ?? "—"}`}>
                          {usdc(t.amount, { compact: false })}
                        </td>
                        <td className="py-1.5">
                          <span className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] ${s.cls}`} title={t.statusReason ?? undefined}>
                            {s.label}
                          </span>
                        </td>
                        <td className="py-1.5">
                          <Checks t={t} />
                        </td>
                        <td className="max-w-[230px] py-1.5 pr-2">{t.recipient ? <Address value={t.recipient} href={t.recipientUrl} label="mint recipient" /> : <span className="text-white/35">—</span>}</td>
                        <td className="max-w-[250px] py-1.5 pr-2">
                          {t.sourceTx ? <Address value={t.sourceTx} href={t.sourceTxUrl} label="burn transaction" /> : <span className="text-white/35">source leg not indexed</span>}
                        </td>
                        <td className="max-w-[250px] py-1.5 pr-2">
                          {t.destinationTx ? (
                            <Address value={t.destinationTx} href={t.destinationTxUrl} label="mint transaction" />
                          ) : (
                            <span className="text-white/35" title={t.statusReason ?? undefined}>
                              {t.destinationMethod === "used_nonce" ? "proven, tx not indexed" : "—"}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right text-white/55">{t.sourceTime ? ago(t.sourceTime) : t.destinationTime ? ago(t.destinationTime) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
