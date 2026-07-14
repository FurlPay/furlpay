// Shared support-ticket model — MUST mirror apps/web/src/lib/support.ts.
// Statuses are server truth; the client renders them, it never invents them.

export type TicketStatus =
  | "open"
  | "waiting_support"
  | "waiting_customer"
  | "in_progress"
  | "resolved"
  | "closed";

export interface StatusStyle {
  label: string;
  fg: string;
  bg: string;
}

// Colors from lib/theme's palette family (kept literal here so this stays a
// pure module usable in tests without native imports).
const NEON = "#E7FF52";
const NEON_SOFT = "#2A2F14";
const WARN = "#FFB454";
const WARN_BG = "#2A230A";
const DIM = "#9AA0A6";
const DIM_BG = "#1C1F24";

export function statusStyle(status: TicketStatus): StatusStyle {
  switch (status) {
    case "open":
    case "waiting_support":
      return { label: status === "open" ? "open" : "with support", fg: WARN, bg: WARN_BG };
    case "waiting_customer":
      return { label: "needs your reply", fg: NEON, bg: NEON_SOFT };
    case "in_progress":
      return { label: "in progress", fg: WARN, bg: WARN_BG };
    case "resolved":
      return { label: "resolved", fg: NEON, bg: NEON_SOFT };
    case "closed":
      return { label: "closed", fg: DIM, bg: DIM_BG };
    default:
      // Unknown server status: render it verbatim rather than lying.
      return { label: String(status), fg: DIM, bg: DIM_BG };
  }
}
