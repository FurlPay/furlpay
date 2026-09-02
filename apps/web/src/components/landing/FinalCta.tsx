import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Reveal from "./Reveal";

const STACK = ["TypeScript", "Python", "Go", "Rust", "REST API", "Webhooks"];

export default function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-white/[0.06]">
      <div
        aria-hidden="true"
        className="hero-glow pointer-events-none absolute inset-x-0 bottom-0 h-[420px]"
      />
      <div className="section section-y relative text-center">
        <Reveal>
          <h2 className="section-title mx-auto max-w-3xl">
            Build the financial layer of your product.
          </h2>
          <p className="section-lede mx-auto mt-4 text-center">
            Payments, accounts, cards, stablecoins and AI agent infrastructure — all through one
            API.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/markets"
              className="btn-green inline-flex w-full items-center justify-center gap-2 px-7 py-3.5 text-[16px] sm:w-auto"
            >
              Explore markets
              <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
            <Link
              href="/travel"
              className="btn-outline inline-flex w-full items-center justify-center px-7 py-3.5 text-[16px] sm:w-auto"
            >
              Travel with us
            </Link>
          </div>

          <p className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 font-mono text-[12px] text-textMuted">
            {STACK.map((item, i) => (
              <span key={item}>
                {i > 0 && <span aria-hidden className="mr-3 text-white/15">·</span>}
                {item}
              </span>
            ))}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
