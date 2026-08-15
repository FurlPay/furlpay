import Link from "next/link";
import { ArrowRight } from "lucide-react";
import InfraFlow from "./InfraFlow";

// Six chips, each backed by something that exists: four first-party SDKs in
// sdks/{node,python,go,rust}, the REST surface documented at
// /docs/architecture/api-routes, and signed webhook delivery at
// /docs/architecture/webhooks.
const STACK = ["TypeScript", "Python", "Go", "Rust", "REST API", "Webhooks"];

/*
 * Centred hero.
 *
 * The composition is a single centred column, not `text-align: center` applied
 * to a full-width block. Each element carries its own max-width and is centred
 * by the flex column, so the measures taper — headline widest, lede narrower,
 * chips narrower still — and every line break is a consequence of a chosen
 * measure rather than of the viewport.
 *
 * `.section` is max-w-6xl, which is the right container for the dense sections
 * further down the page but far too wide to read a sentence across. So the
 * copy sits in its own max-w-3xl column inside it, and the width of `.section`
 * is spent on the one thing that benefits from it: the InfraFlow pipeline.
 */
export default function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Already centred: radial-gradient(… at 50% 40%) across inset-x-0. It
          read as left-biased only because the content it sat behind was. */}
      <div
        aria-hidden="true"
        className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[560px]"
      />
      <div className="section relative pb-20 pt-16 sm:pt-24 lg:pb-28 lg:pt-28">
        {/* ── Copy ──────────────────────────────────────────────────── */}
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <p className="section-eyebrow">Financial infrastructure</p>

          {/* max-w-3xl at this size lands the sentence on three lines on a
              desktop and never runs past a comfortable measure. `balance`
              keeps those lines even instead of leaving a short last one. */}
          <h1
            className="mt-5 max-w-3xl font-extrabold tracking-tighter text-textPrimary"
            style={{ fontSize: "clamp(34px, 5.4vw, 58px)", lineHeight: 1.04, textWrap: "balance" }}
          >
            The financial infrastructure for apps, agents, and the{" "}
            <span className="text-neon">internet economy.</span>
          </h1>

          {/* Deliberately narrower than the headline: ~65 characters is the
              readable measure for body copy, and the step down in width is
              what makes the centre column read as composed. */}
          <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-textSecondary sm:text-[18px]">
            Move money, issue cards, open global accounts, accept stablecoins, and let AI agents
            pay — all through one API.
          </p>

          {/* Two primary actions on one line, the tertiary link on its own
              beneath — so the pair reads as a choice and "View docs" does not
              compete with them. Stacks full-width below `sm`. */}
          <div className="mt-9 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
            <Link
              href="/developer/keys"
              className="btn-green inline-flex w-full items-center justify-center gap-2 px-6 py-3.5 text-[15px] sm:w-auto"
            >
              Get your API key
              <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
            <Link
              href="/talk-to-us"
              className="btn-outline inline-flex w-full items-center justify-center px-6 py-3.5 text-[15px] sm:w-auto"
            >
              Talk to engineering
            </Link>
          </div>

          <Link
            href="/docs"
            className="mt-4 inline-flex items-center justify-center gap-1.5 px-2 py-2 text-[15px] font-semibold text-textSecondary transition-colors hover:text-white"
          >
            View docs
            <span aria-hidden>→</span>
          </Link>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
            {STACK.map((item) => (
              <span key={item} className="tech-chip">
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* ── Diagram ───────────────────────────────────────────────── */}
        {/* The full width of `.section`, under a centred column that is
            deliberately narrower. The asymmetry is the point: the copy is a
            readable measure, the pipeline is the wide thing that anchors it,
            and the stages read left to right beneath centred type. */}
        <div className="mt-16 w-full lg:mt-20">
          <InfraFlow />
        </div>
      </div>
    </section>
  );
}
