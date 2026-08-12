import Link from "next/link";
import { ArrowRight } from "lucide-react";
import InfraFlow from "./InfraFlow";

// Six chips, each backed by something that exists: four first-party SDKs in
// sdks/{node,python,go,rust}, the REST surface documented at
// /docs/architecture/api-routes, and signed webhook delivery at
// /docs/architecture/webhooks.
const STACK = ["TypeScript", "Python", "Go", "Rust", "REST API", "Webhooks"];

export default function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[560px]"
      />
      <div className="section relative grid items-center gap-12 pb-16 pt-14 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:pb-24">
        {/* ── Copy ──────────────────────────────────────────────────── */}
        <div>
          <p className="section-eyebrow">Financial infrastructure</p>

          <h1 className="mt-4 max-w-xl font-extrabold tracking-tighter text-textPrimary" style={{ fontSize: "clamp(34px, 5.4vw, 58px)", lineHeight: 1.03, textWrap: "balance" }}>
            The financial infrastructure for apps, agents, and the{" "}
            <span className="text-neon">internet economy.</span>
          </h1>

          <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-textSecondary sm:text-[18px]">
            Move money, issue cards, open global accounts, accept stablecoins, and let AI agents
            pay — all through one API.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/developer/keys"
              className="btn-green inline-flex items-center justify-center gap-2 px-6 py-3.5 text-[15px]"
            >
              Get your API key
              <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
            <Link
              href="/talk-to-us"
              className="btn-outline inline-flex items-center justify-center px-6 py-3.5 text-[15px]"
            >
              Talk to engineering
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center justify-center gap-1.5 px-2 py-3.5 text-[15px] font-semibold text-textSecondary transition-colors hover:text-white"
            >
              View docs
              <span aria-hidden>→</span>
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            {STACK.map((item) => (
              <span key={item} className="tech-chip">
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* ── Diagram ───────────────────────────────────────────────── */}
        <div className="lg:pl-4">
          <InfraFlow />
        </div>
      </div>
    </section>
  );
}
