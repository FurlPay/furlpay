import { capability, STATUS_LABEL, type CapabilityStatus } from "@/lib/productionStatus";

/*
 * One badge, one vocabulary.
 *
 * Before this existed, "coming soon", "beta", "in development", "launching"
 * and an unlabelled amber dot all appeared on the same site for capabilities
 * in identical states — and "live" appeared beside two that were not. The
 * wording now comes from lib/productionStatus.ts rather than from whoever
 * wrote the section, so a reader who learns what one badge means has learned
 * what all of them mean.
 *
 * The `title` carries the evidence or the gate, so hovering a badge answers
 * "says who?" without the page having to spend a paragraph on it.
 */

const TONE: Record<CapabilityStatus, string> = {
  live: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  internal: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  roadmap: "border-white/15 bg-white/[0.04] text-textSecondary",
};

export default function StatusPill({ id, className = "" }: { id: string; className?: string }) {
  const c = capability(id);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${TONE[c.status]} ${className}`}
      title={c.gate ? `${c.evidence} ${c.gate}` : c.evidence}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${c.status === "live" ? "bg-emerald-400" : "bg-current opacity-70"}`}
      />
      {STATUS_LABEL[c.status]}
    </span>
  );
}
