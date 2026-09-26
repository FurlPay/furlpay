// ---------------------------------------------------------------------------
// The ticket-list view model.
//
// Extracted from the page so the one rule that matters here is testable without
// rendering: GET /api/support/tickets returns the FULL SupportTicket record —
// `userId`, `email` and `body` included — and none of those may reach the DOM.
//
// A component that spreads the API object into props would leak all three the
// moment someone adds a debug attribute or a `JSON.stringify`. Narrowing here
// means the row component is never handed the fields in the first place.
// ---------------------------------------------------------------------------

/** Exactly what a row renders. Deliberately NOT SupportTicket. */
export interface TicketRow {
  id: string;
  subject: string;
  status: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

/** Fields the API returns that must never be rendered. Asserted in tests. */
export const SENSITIVE_FIELDS = ["userId", "email", "body"] as const;

/** Display names for TICKET_CATEGORIES. Keys are the enum verbatim. */
export const CATEGORY_LABEL: Record<string, string> = {
  stablecoins: "Wallet & Payments",
  cards: "Cards",
  kyc: "Identity & KYC",
  travel: "Travel",
  developers: "Developer Tools",
  other: "Other",
};

export const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  waiting_support: "Waiting on support",
  waiting_customer: "Awaiting your reply",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

/** Filters, matching the statuses the model actually has. */
export const FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "pending", label: "Pending" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
] as const;

export type FilterKey = (typeof FILTERS)[number]["key"];

/**
 * Which statuses each filter covers.
 *
 * "Pending" is a UI grouping, not a stored status: the model has three distinct
 * waiting states and a flat list of five filters cannot show them separately
 * without the tabs outnumbering the tickets. `waiting_support`,
 * `waiting_customer` and `in_progress` all mean "in flight", so they group.
 */
export function matchesFilter(status: string, filter: FilterKey): boolean {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return status === "open";
    case "pending":
      return status === "waiting_support" || status === "waiting_customer" || status === "in_progress";
    case "resolved":
      return status === "resolved";
    case "closed":
      return status === "closed";
  }
}

/**
 * Narrow the API payload to what a row needs, newest activity first.
 *
 * `listTickets` returns the stored array unsorted, so ordering is applied here
 * rather than assumed — without it a reply to an old ticket leaves it buried.
 */
export function toRows(tickets: unknown): TicketRow[] {
  if (!Array.isArray(tickets)) return [];
  return tickets
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object")
    .map((t) => ({
      id: String(t.id ?? ""),
      subject: String(t.subject ?? "(no subject)"),
      status: String(t.status ?? "open"),
      category: String(t.category ?? "other"),
      createdAt: String(t.createdAt ?? ""),
      updatedAt: String(t.updatedAt ?? t.createdAt ?? ""),
    }))
    .filter((t) => t.id)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** Free-text search over the fields a row shows — never over the body. */
export function searchRows(rows: TicketRow[], query: string): TicketRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.subject.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      (CATEGORY_LABEL[r.category] ?? r.category).toLowerCase().includes(q)
  );
}

/** "Updated 25 Sep 2026" — short, and absolute past a week. */
export function formatUpdated(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Where a ticket row links.
 *
 * `/support/[id]`, NOT `/support/tickets/[id]`. The detail route is at the
 * former and the latter does not exist — linking to it would 404 in exactly the
 * way `/support/new` did before the static segment was added. One place so the
 * page and its tests cannot disagree.
 */
export function ticketHref(id: string): string {
  return `/support/${encodeURIComponent(id)}`;
}
