import Link from "next/link";
import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";
import { seoMetadata } from "@/lib/seo/meta";
import { FURL_MINT, FURL_DECIMALS, FURL_TOTAL_SUPPLY, FURL_EXPLORER } from "@/lib/token/furl";
import { FURL_SPOKES, bridgeIsLive } from "@/lib/token/furlBridge";

// ---------------------------------------------------------------------------
// /bridge — FURL cross-chain bridge.
//
// THE BRIDGE DOES NOT EXIST. No NTT contract is deployed, no spoke token exists,
// and no FURL is locked. This page says that plainly instead of rendering a
// disabled widget behind a "coming soon" ribbon, because a chain selector and an
// amount box — even greyed out — tell a visitor the machinery is built and
// merely switched off. It is not built.
//
// The Wormhole Connect widget is deliberately NOT installed yet. It exists
// (@wormhole-foundation/wormhole-connect 6.0.0, verified on npm) and it is the
// right component for this page — the day there is a bridge for it to connect
// to. Shipping ~MBs of bridge widget into the bundle to render a permanently
// disabled form would be cost with no function.
//
// What this page does instead: explain the intended architecture, publish the
// invariant that will govern it, and state exactly what is blocking it. That is
// useful to a reader today; a fake bridge form is not.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  ...seoMetadata({
    title: "FURL Bridge",
    ogTitle: "FURL cross-chain bridge",
    description:
      "The planned FURL cross-chain architecture: Solana as the canonical hub, EVM spokes via Wormhole NTT, and the supply invariant that governs it. Not yet deployed.",
    path: "/bridge",
  }),
};

const ARCHITECTURE = [
  {
    title: "Solana is the hub",
    body:
      "FURL's canonical 1,000,000,000 supply and its published tokenomics live on Solana. Bridging locks FURL there and mints a representation on the destination chain. The accounting stays in one place.",
  },
  {
    title: "EVM spokes burn and mint",
    body:
      "Each spoke runs a CanonicalFURL ERC-20 at 6 decimals — matching the Solana mint exactly. Bridging out burns the spoke tokens and unlocks the Solana originals. Spoke-to-spoke never touches Solana.",
  },
  {
    title: "Supply cannot exceed the cap",
    body:
      "The spoke contract refuses to mint past 1,000,000,000 FURL, so a compromised bridge manager cannot print supply that no locked balance backs. The cap is enforced by the contract, not by a promise.",
  },
  {
    title: "The invariant is published, not asserted",
    body:
      "Locked FURL on Solana must equal the sum of every spoke's supply. /api/token/furl/supply/cross-chain evaluates that on every request so anyone can check it — which is the only thing that ever catches a bridge minting tokens nothing backs.",
  },
];

const BLOCKERS = [
  {
    title: "Treasury custody comes first",
    body:
      "100% of FURL sits in one deployer-controlled account. Bridging before that is fixed would multiply a single-key exposure across every chain it reaches, rather than reducing it.",
    severity: "critical" as const,
  },
  {
    title: "Deployment is unfunded",
    body:
      "The NTT program accounts need roughly 1.5–2.5 SOL on Solana; the deployer holds 0.048 SOL. No funded EVM deployer key exists for Arbitrum or Base.",
    severity: "blocked" as const,
  },
  {
    title: "No liquidity on any chain",
    body:
      "A bridge moves a token between chains; it does not make it tradable. Without pools, FURL would be bridgeable and still unsellable everywhere. That is a separate and far larger cost than deployment.",
    severity: "blocked" as const,
  },
  {
    title: "Security parameters undecided",
    body:
      "The transceiver threshold, the manager owner and the pause authority are all open decisions. A bridge whose pause authority is a single hot key has no pause authority.",
    severity: "blocked" as const,
  },
];

export default function BridgePage() {
  const live = bridgeIsLive();

  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Bridge", path: "/bridge" },
        ])}
      />

      <main className="section pb-24 pt-14">
        <p className="section-eyebrow">FURL bridge</p>
        <h1 className="section-title mt-3">
          Cross-chain FURL, <span className="text-neon">when it is real</span>.
        </h1>
        <p className="section-lede mt-4">
          FURL exists on Solana and nowhere else. There is no bridge contract, no token on any
          other chain, and no FURL locked. This page describes what is planned and what is
          stopping it — it is not a bridge you can use yet.
        </p>

        {/* ---- current state, stated first --------------------------------- */}
        <section className="mt-10">
          <div className="rounded-card border border-accent/30 bg-accent/[0.05] p-6">
            <p className="text-[15px] font-bold text-accent">
              {live ? "Bridge live" : "Not deployed — FURL is Solana-only"}
            </p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-textSecondary">
              No Wormhole NTT contract has been deployed on any chain. No CanonicalFURL ERC-20
              exists on Arbitrum, Base, or anywhere else. Zero FURL is locked. Any site offering
              to bridge, swap, or sell FURL on another chain today is not offering this token.
            </p>
            <a
              href={FURL_EXPLORER}
              target="_blank"
              rel="noreferrer"
              className="btn-outline mt-5 inline-flex px-5 py-2.5 text-[13px]"
            >
              Verify the one real mint
            </a>
          </div>
        </section>

        {/* ---- chains ------------------------------------------------------ */}
        <section className="mt-16">
          <h2 className="text-[26px] font-bold tracking-tighter">Chains</h2>
          <div className="mt-6 surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-white/[0.08] text-[11px] uppercase tracking-[0.12em] text-textMuted">
                    <th className="px-5 py-3 font-semibold">Chain</th>
                    <th className="px-5 py-3 font-semibold">Role</th>
                    <th className="px-5 py-3 font-semibold">Token</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-white/[0.05]">
                    <td className="px-5 py-3.5 font-semibold">Solana</td>
                    <td className="px-5 py-3.5 text-textSecondary">Hub (locking)</td>
                    <td className="px-5 py-3.5 font-mono text-[11.5px] text-textSecondary">
                      {FURL_MINT.slice(0, 10)}…{FURL_MINT.slice(-6)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="rounded-full bg-neon/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-neon">
                        Live
                      </span>
                    </td>
                  </tr>
                  {FURL_SPOKES.map((s) => (
                    <tr key={s.chainId} className="border-b border-white/[0.05] last:border-0">
                      <td className="px-5 py-3.5 font-semibold">{s.chain}</td>
                      <td className="px-5 py-3.5 text-textSecondary">Spoke (burning)</td>
                      <td className="px-5 py-3.5 font-mono text-[11.5px] text-textMuted">
                        {s.token ?? "not deployed"}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-textSecondary">
                          Planned
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-textMuted">
            FURL is a Token-2022 mint with {FURL_DECIMALS} decimals and a fixed{" "}
            {FURL_TOTAL_SUPPLY.toLocaleString("en-US")} supply. Every spoke would match those
            decimals exactly — an 18-decimal spoke against a 6-decimal hub would mis-scale every
            bridged amount by a factor of a trillion.
          </p>
        </section>

        {/* ---- architecture ------------------------------------------------ */}
        <section className="mt-16">
          <h2 className="text-[26px] font-bold tracking-tighter">How it would work</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {ARCHITECTURE.map((a) => (
              <div key={a.title} className="surface p-6">
                <h3 className="text-[15px] font-bold">{a.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-textSecondary">{a.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---- blockers ---------------------------------------------------- */}
        <section className="mt-16">
          <h2 className="text-[26px] font-bold tracking-tighter">What is stopping it</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-textSecondary">
            In order. The first one is not about money.
          </p>
          <div className="mt-6 space-y-3">
            {BLOCKERS.map((b) => (
              <div
                key={b.title}
                className={`rounded-card border p-5 ${
                  b.severity === "critical"
                    ? "border-accent/30 bg-accent/[0.05]"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                      b.severity === "critical"
                        ? "bg-accent/15 text-accent"
                        : "bg-white/[0.06] text-textSecondary"
                    }`}
                  >
                    {b.severity === "critical" ? "Critical" : "Blocked"}
                  </span>
                  <h3 className="text-[15px] font-bold">{b.title}</h3>
                </div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-textSecondary">{b.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---- integrators ------------------------------------------------- */}
        <section className="mt-16">
          <h2 className="text-[26px] font-bold tracking-tighter">For integrators</h2>
          <div className="mt-6 surface p-6">
            <p className="text-[13.5px] leading-relaxed text-textSecondary">
              The cross-chain supply breakdown and the invariant check are served as JSON. Today
              it reports one chain, zero locked, and{" "}
              <span className="font-mono text-[12.5px]">NOT_APPLICABLE</span> — because there is
              no second side to reconcile against yet.
            </p>
            <code className="mt-4 block select-all break-all rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-[12.5px]">
              GET /api/token/furl/supply/cross-chain
            </code>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/token" className="btn-green px-5 py-2.5 text-[14px]">
                FURL token page
              </Link>
              <Link href="/docs/tokens/furl" className="btn-outline px-5 py-2.5 text-[14px]">
                Integration docs
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
