import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Reveal from "./Reveal";

/*
 * The agent differentiator, with the actual control flow drawn out.
 *
 * Every step maps to something in this repo — agent keys (/api/agents/keys),
 * the policy engine (lib/agentPolicy.ts), passkey approval on money-moving
 * tool calls (lib/mcp/tools.ts), x402 settlement (lib/x402Settler.ts). The
 * ordering is the real one: the policy is evaluated and the human approves
 * BEFORE the USDC transfer, which is the whole argument for the product.
 *
 * Motion is CSS-only (a travelling gradient down the connector rail), so this
 * section costs no JavaScript and stops under prefers-reduced-motion.
 */

const STEPS = [
  { label: "AI agent", note: "Your model, framework or workflow", tone: "plain" },
  { label: "Agent wallet", note: "Its own key — never the account's", tone: "plain" },
  { label: "Policy engine", note: "Per-agent caps, allowlists, velocity", tone: "accent" },
  { label: "Human approval", note: "Passkey confirmation before funds move", tone: "accent" },
  { label: "USDC payment", note: "EIP-3009 authorization, settled on-chain", tone: "plain" },
  { label: "Merchant or API", note: "Paid per call over HTTP 402", tone: "plain" },
  { label: "Settlement", note: "Receipt, ledger entry, audit record", tone: "plain" },
] as const;

const HIGHLIGHTS = [
  "Agent wallets",
  "Spending limits",
  "Human approval",
  "Programmable payments",
  "x402",
];

export default function AgentSection() {
  return (
    <section
      className="border-y border-white/[0.06] bg-white/[0.012]"
      id="agents"
      aria-labelledby="agents-title"
    >
      <div className="section section-y grid gap-12 lg:grid-cols-[1fr_minmax(0,420px)] lg:gap-16">
        <Reveal>
          <p className="section-eyebrow">AI agents</p>
          <h2 className="section-title mt-3" id="agents-title">
            Give AI agents the ability to transact.
          </h2>
          <p className="section-lede mt-4">
            Give autonomous software access to programmable financial infrastructure — with
            permissions, limits and policies built in.
          </p>

          <div className="mt-7 flex flex-wrap gap-2">
            {HIGHLIGHTS.map((h) => (
              <span key={h} className="tech-chip">
                {h}
              </span>
            ))}
          </div>

          <p className="mt-7 max-w-xl text-[14px] leading-relaxed text-textSecondary">
            An agent key is not an account key. It carries its own policy — per-transaction and
            daily caps, allowed counterparties, velocity limits — evaluated before anything
            moves. Money-moving tool calls return an approval URL instead of a result: the model
            proposes, a human with a passkey disposes.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/solutions/ai-agents" className="btn-green px-6 py-3 text-[15px]">
              Agent infrastructure
            </Link>
            <Link href="/docs/payments/agentic-x402" className="btn-outline px-6 py-3 text-[15px]">
              Read the x402 guide
            </Link>
          </div>
        </Reveal>

        <Reveal delay={80}>
          <ol className="rounded-[26px] border border-white/[0.08] bg-black/40 p-4 sm:p-5">
            {STEPS.map((step, i) => (
              <li key={step.label}>
                {i > 0 && (
                  <div aria-hidden="true" className="flex justify-center py-1">
                    <span className="flow-rail block h-6 w-px rounded-full" />
                  </div>
                )}
                <div
                  className={`rounded-xl border px-4 py-3 ${
                    step.tone === "accent"
                      ? "border-neon/30 bg-neon/[0.06]"
                      : "border-white/[0.08] bg-white/[0.02]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[14px] font-semibold text-white">{step.label}</p>
                    <span className="font-mono text-[10px] text-textMuted">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-textSecondary">{step.note}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-3 flex items-center gap-1.5 px-1 text-[11.5px] text-textMuted">
            <ArrowRight aria-hidden className="h-3 w-3" />
            Policy and approval are evaluated before settlement, never after.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
