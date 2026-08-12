import Link from "next/link";
import Reveal from "./Reveal";
import RailStatus from "./RailStatus";

/*
 * "Built for production" — and specifically NOT an uptime number.
 *
 * No verified uptime figure exists for this deployment, so none is printed.
 * What can be shown honestly is (a) the live status of each payment rail, read
 * from the public /api/rails endpoint at page load, and (b) the engineering
 * properties that are visible in the repo, each naming the file that enforces
 * it. Both are checkable by the reader, which is the point.
 */

const GUARANTEES = [
  {
    title: "Fails closed, loudly",
    body: "An upstream error returns an error. The bank directory answers 502 rather than an empty list; the durable store refuses its in-memory fallback in production instead of silently forgetting writes.",
    path: "lib/hkma.ts · lib/kv.ts",
  },
  {
    title: "Auth posture enforced in CI",
    body: "Every route's authentication class is declared in a manifest and checked on every build, so a handler cannot quietly become public.",
    path: "security/route-manifest.json · scripts/check-route-security.mjs",
  },
  {
    title: "Replay-protected webhooks",
    body: "Signatures are verified over the raw body with a constant-time compare, and stale timestamps are rejected. Delivery is idempotent by key.",
    path: "/docs/architecture/webhooks · lib/idempotency.ts",
  },
  {
    title: "Probes with hard timeouts",
    body: "Dependency health is a real round-trip per component with a bounded timeout and a 30-second cache — never a status constant someone forgot to update.",
    path: "/api/ops/health",
  },
];

export default function ProductionSection() {
  return (
    <section className="section section-y" id="production" aria-labelledby="production-title">
      <div className="grid gap-12 lg:grid-cols-[1fr_minmax(0,400px)] lg:gap-16">
        <Reveal>
          <p className="section-eyebrow">Production</p>
          <h2 className="section-title mt-3" id="production-title">
            Built for production.
          </h2>
          <p className="section-lede mt-4">
            The interesting question about payment infrastructure is not what it does when
            everything works. These are the behaviours under failure, and where to check them.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {GUARANTEES.map((g) => (
              <div key={g.title} className="surface p-5">
                <p className="text-[15px] font-bold">{g.title}</p>
                <p className="mt-2 text-[13px] leading-relaxed text-textSecondary">{g.body}</p>
                <code className="mt-3 block break-words font-mono text-[11px] text-textMuted">
                  {g.path}
                </code>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={80}>
          <div className="surface p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[15px] font-bold">Rail status</p>
              <span className="font-mono text-[10.5px] text-textMuted">GET /api/rails</span>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-textSecondary">
              Read live from this deployment when the page loaded. A rail without production
              credentials reports “not configured” rather than a green light.
            </p>

            <div className="mt-5">
              <RailStatus />
            </div>

            <Link
              href="/status"
              className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-neon transition-colors hover:text-white"
            >
              Full status board
              <span aria-hidden>→</span>
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
