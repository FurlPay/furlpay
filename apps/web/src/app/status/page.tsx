import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import { publicRailStatuses, type RailStatus } from "@/lib/ops/overview";
import { PRODUCT_LABELS } from "@/lib/analytics/products";
import type { Rail } from "@/lib/ops/controls";
import { headline } from "@/lib/statusHeadline";

export const metadata: Metadata = {
  title: "Status",
  description: "Furlpay system status: live operational state of each payment rail.",
  alternates: { canonical: "/status" },
};

// Rendered per request from the same public-safe source /api/rails uses: each
// rail's pause state plus its most recent health signal, ignored once stale.
// This page used to hardcode "All systems operational" and seven green rows
// regardless of reality. It now shows only what is measured, says "unknown"
// when nothing recent is known, and never infers health from configuration.
export const dynamic = "force-dynamic";

const LABEL: Record<RailStatus, string> = {
  HEALTHY: "Operational",
  DEGRADED: "Degraded",
  INCIDENT: "Incident",
  PAUSED: "Paused",
  NOT_CONFIGURED: "Not available",
  UNKNOWN: "No recent signal",
};
const TONE: Record<RailStatus, string> = {
  HEALTHY: "bg-gain text-gain",
  DEGRADED: "bg-[#E5C07B] text-[#E5C07B]",
  INCIDENT: "bg-[#E06C75] text-[#E06C75]",
  PAUSED: "bg-[#E5C07B] text-[#E5C07B]",
  NOT_CONFIGURED: "bg-white/30 text-textMuted",
  UNKNOWN: "bg-white/30 text-textMuted",
};

export default async function StatusPage() {
  let rails: [Rail, RailStatus][] | null = null;
  try {
    rails = Object.entries(await publicRailStatuses()) as [Rail, RailStatus][];
  } catch {
    rails = null;
  }
  const head = headline(rails ? rails.map(([, s]) => s) : null);
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Status</p>
        <div className="flex items-center gap-3">
          <span className={`inline-flex h-3 w-3 rounded-full ${head.tone}`} aria-hidden />
          <h1 className="text-[32px] font-extrabold tracking-tighter sm:text-[40px]">{head.text}</h1>
        </div>

        {rails ? (
          <div className="mt-10 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10">
            {rails.map(([rail, status]) => (
              <div key={rail} className="flex items-center justify-between px-5 py-4">
                <span className="text-[15px]">{PRODUCT_LABELS[rail] ?? rail}</span>
                <span className={`flex items-center gap-2 text-[13px] font-semibold ${TONE[status].split(" ")[1]}`}>
                  <span className={`h-2 w-2 rounded-full ${TONE[status].split(" ")[0]}`} aria-hidden /> {LABEL[status]}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-10 rounded-2xl border border-white/10 px-5 py-4 text-[14px] text-textMuted">
            The status source could not be reached. This is not a statement that services are down or up.
          </p>
        )}

        <p className="mt-6 text-[12px] text-textMuted">
          Each rail shows its pause state and its most recent health signal; a rail with no recent signal shows
          &ldquo;No recent signal&rdquo; rather than a guess. This page does not yet cover the dashboard, webhooks or MCP
          server, which have no public health signal. For incidents or a security report, email{" "}
          <a href="mailto:hello@furlpay.com" className="text-neon hover:underline">hello@furlpay.com</a>.
        </p>
      </main>
    </div>
  );
}
