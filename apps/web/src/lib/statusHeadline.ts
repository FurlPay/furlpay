import type { RailStatus } from "@/lib/ops/overview";

// The public /status headline, derived only from measured rail statuses.
// "Operational" requires every configured rail to have a fresh HEALTHY signal;
// anything unknown says so instead of defaulting to green.
export function headline(statuses: RailStatus[] | null): { text: string; tone: string } {
  if (!statuses) return { text: "Status currently unavailable", tone: "bg-white/40" };
  if (statuses.includes("INCIDENT")) return { text: "Service disruption", tone: "bg-[#E06C75]" };
  if (statuses.some((s) => s === "DEGRADED" || s === "PAUSED")) return { text: "Some services degraded", tone: "bg-[#E5C07B]" };
  const live = statuses.filter((s) => s !== "NOT_CONFIGURED");
  if (live.length && live.every((s) => s === "HEALTHY")) return { text: "All monitored rails operational", tone: "bg-gain" };
  return { text: "Status partially unknown", tone: "bg-white/40" };
}
