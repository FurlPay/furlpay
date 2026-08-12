import Link from "next/link";
import { Fingerprint, Cpu, SlidersHorizontal, KeyRound, ScrollText } from "lucide-react";
import Reveal from "./Reveal";

/*
 * Security, moved up the page — it is the objection a payments reader has
 * second, right after "what is it".
 *
 * Only implemented capabilities appear here. No SOC 2, no PCI, no ISO, no
 * regulatory approval: none of those have been attested for this deployment,
 * and a compliance badge is the easiest claim in fintech to make and the
 * hardest to walk back.
 */

const CONTROLS = [
  {
    Icon: Fingerprint,
    title: "Authentication",
    body: "WebAuthn passkeys, with a step-up challenge required before money moves. Phishing-resistant by construction — there is no password to hand over.",
    path: "lib/webauthn.ts",
  },
  {
    Icon: SlidersHorizontal,
    title: "Transaction controls",
    body: "Per-transaction caps live in the rail registry, not in a caller's request. A payload cannot ask to exceed its own limit.",
    path: "lib/rails/registry.ts · lib/moneyLimits.ts",
  },
  {
    Icon: KeyRound,
    title: "Spending limits for agents",
    body: "Every agent key carries its own policy — amount, counterparty and velocity — evaluated before settlement, with human approval on money-moving calls.",
    path: "lib/agentPolicy.ts",
  },
  {
    Icon: Cpu,
    title: "Key custody",
    body: "2-of-2 MPC with an HSM policy co-signer: no single key that can move funds ever exists in one place.",
    path: "lib/custody.ts",
  },
  {
    Icon: ScrollText,
    title: "Audit logs",
    body: "Money movement writes an audit record, and a failed or dropped write is surfaced as degraded rather than counted silently — a hole in the trail is still a hole.",
    path: "lib/audit.ts · lib/auditDb.ts",
  },
];

export default function SecuritySection() {
  return (
    <section
      className="border-y border-white/[0.06] bg-white/[0.012]"
      id="security"
      aria-labelledby="security-title"
    >
      <div className="section section-y">
        <Reveal>
          <p className="section-eyebrow">Security</p>
          <h2 className="section-title mt-3 max-w-3xl" id="security-title">
            Built for money. Designed for security.
          </h2>
          <p className="section-lede mt-4">
            Five controls that are implemented, each naming the module that implements it. No
            certification badges appear on this page, because none have been attested.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CONTROLS.map((c, i) => (
            <Reveal delay={i * 55} key={c.title}>
              <div className="surface surface-lift h-full p-6">
                <c.Icon aria-hidden className="mb-4 h-6 w-6 text-neon" />
                <p className="text-[16px] font-bold">{c.title}</p>
                <p className="mt-2 text-[13px] leading-relaxed text-textSecondary">{c.body}</p>
                <code className="mt-3 block break-words font-mono text-[11px] text-textMuted">{c.path}</code>
              </div>
            </Reveal>
          ))}

          <Reveal delay={275}>
            <Link
              href="/trust"
              className="surface surface-lift group flex h-full flex-col justify-between p-6"
            >
              <div>
                <p className="text-[16px] font-bold">Trust &amp; security centre</p>
                <p className="mt-2 text-[13px] leading-relaxed text-textSecondary">
                  Threat model, disclosure policy, and what is and is not covered today.
                </p>
              </div>
              <span className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-neon">
                Read the detail
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
              </span>
            </Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
