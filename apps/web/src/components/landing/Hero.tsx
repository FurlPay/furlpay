import Link from "next/link";
import { ArrowRight } from "lucide-react";
import InfraFlow from "./InfraFlow";

// The stack chips that used to sit under the CTAs are gone: TypeScript /
// Python / Go / Rust and REST / Webhooks are now stated by the first two
// stages of InfraFlow directly below, with the context of where in the
// pipeline they apply. Two rows of the same six words read as filler.

export default function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[560px]"
      />
      <div className="section relative pb-16 pt-14 sm:pt-20 lg:pb-24">
        {/* ── Copy ──────────────────────────────────────────────────── */}
        <div>
          <p className="section-eyebrow">Financial infrastructure</p>

          {/* max-w-3xl, not max-w-xl. `.section` is max-w-6xl, so a 36rem
              headline left half the container empty and read as an accident.
              48rem lets the line break where the sentence wants to and gives
              the type the dominance the page is asking of it. */}
          <h1 className="mt-4 max-w-3xl font-extrabold tracking-tighter text-textPrimary" style={{ fontSize: "clamp(34px, 5.4vw, 58px)", lineHeight: 1.03, textWrap: "balance" }}>
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

        </div>

        {/* ── Diagram ───────────────────────────────────────────────── */}
        {/* Full container width, beneath the copy. Beside the headline it was
            a narrow column fighting its own top-to-bottom reading order;
            centred and narrow it left the same emptiness it was meant to
            resolve. Run across the full measure it becomes the thing that
            balances the composition — the stages read left to right, in the
            same direction as the sentence above them. */}
        <div className="mt-14 w-full lg:mt-16">
          <InfraFlow />
        </div>
      </div>
    </section>
  );
}
