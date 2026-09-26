import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABEL,
  SENSITIVE_FIELDS,
  formatUpdated,
  matchesFilter,
  searchRows,
  ticketHref,
  toRows,
} from "../ticketList";

// ---------------------------------------------------------------------------
// The ticket-list view model.
//
// The payload below is the SHAPE THE RUNNING API RETURNS, captured from
// GET /api/support/tickets rather than copied from the TypeScript type:
//   id, userId, email, category, subject, body, status, createdAt, updatedAt
//
// That distinction is the point of the first test. The route hands the client
// the full stored record — including the owner's id, their email address and
// the ticket body — and none of it may reach a list row.
// ---------------------------------------------------------------------------

const API_TICKET = {
  id: "tkt_cb1276cb-02a",
  userId: "usr_private_identifier",
  email: "someone@example.com",
  category: "stablecoins",
  subject: "USDC deposit not reflecting in my account",
  body: "Deposit from Solana wallet has not landed. Transaction hash: 5xK...9d2f",
  status: "open",
  createdAt: "2026-09-23T11:55:00.000Z",
  updatedAt: "2026-09-25T10:21:00.000Z",
};

describe("the list row never carries private fields", () => {
  it("drops userId, email and body from the API payload", () => {
    const [row] = toRows([API_TICKET]);
    for (const field of SENSITIVE_FIELDS) {
      expect(row, `${field} must not survive into a row`).not.toHaveProperty(field);
    }
    // And positively: the row has exactly the six fields a row renders, so a
    // future field added to the API cannot ride along unnoticed.
    expect(Object.keys(row).sort()).toEqual([
      "category",
      "createdAt",
      "id",
      "status",
      "subject",
      "updatedAt",
    ]);
  });

  it("cannot leak a private field by serialising the row", () => {
    // The realistic failure is not reading `row.email` — it is something
    // stringifying the object into an attribute or a debug dump.
    const serialised = JSON.stringify(toRows([API_TICKET]));
    expect(serialised).not.toContain("usr_private_identifier");
    expect(serialised).not.toContain("someone@example.com");
    expect(serialised).not.toContain("5xK...9d2f");
  });
});

describe("ordering", () => {
  it("puts the most recently updated ticket first", () => {
    // listTickets returns the stored array unsorted, so a reply to an old
    // ticket would otherwise leave it buried where the user cannot find it.
    const rows = toRows([
      { ...API_TICKET, id: "old", updatedAt: "2026-01-01T00:00:00.000Z" },
      { ...API_TICKET, id: "new", updatedAt: "2026-09-25T00:00:00.000Z" },
      { ...API_TICKET, id: "mid", updatedAt: "2026-06-01T00:00:00.000Z" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  it("falls back to createdAt when updatedAt is absent", () => {
    const rows = toRows([{ id: "a", subject: "s", status: "open", category: "other", createdAt: "2026-05-05T00:00:00.000Z" }]);
    expect(rows[0].updatedAt).toBe("2026-05-05T00:00:00.000Z");
  });
});

describe("malformed payloads do not throw", () => {
  it("survives a non-array, nulls and missing ids", () => {
    // A list page that throws on a bad payload shows a blank screen rather than
    // an error state, which is the worse failure.
    expect(toRows(null)).toEqual([]);
    expect(toRows({ tickets: [] })).toEqual([]);
    expect(toRows([null, undefined, 42, "x"])).toEqual([]);
    expect(toRows([{ subject: "no id here" }])).toEqual([]);
  });

  it("gives a ticket with no subject something readable", () => {
    expect(toRows([{ id: "a", createdAt: "2026-01-01T00:00:00.000Z" }])[0].subject).toBe("(no subject)");
  });
});

describe("filters cover every stored status", () => {
  it("groups the three in-flight states under Pending", () => {
    // The model has waiting_support, waiting_customer and in_progress. Five
    // filter tabs cannot show them separately, and a status matching NO filter
    // would make its tickets invisible under every tab.
    for (const s of ["waiting_support", "waiting_customer", "in_progress"]) {
      expect(matchesFilter(s, "pending"), `${s} should be Pending`).toBe(true);
      expect(matchesFilter(s, "open")).toBe(false);
    }
  });

  it("every status appears under at least one filter besides All", () => {
    const statuses = ["open", "waiting_support", "waiting_customer", "in_progress", "resolved", "closed"];
    const named = (["open", "pending", "resolved", "closed"] as const);
    for (const s of statuses) {
      expect(named.some((f) => matchesFilter(s, f)), `${s} is unreachable`).toBe(true);
    }
  });

  it("All matches everything", () => {
    expect(matchesFilter("closed", "all")).toBe(true);
    expect(matchesFilter("open", "all")).toBe(true);
  });
});

describe("search", () => {
  const rows = toRows([
    { ...API_TICKET, id: "t1", subject: "USDC deposit missing", category: "stablecoins" },
    { ...API_TICKET, id: "t2", subject: "Flight refund", category: "travel" },
  ]);

  it("matches subject, id and category label", () => {
    expect(searchRows(rows, "usdc").map((r) => r.id)).toEqual(["t1"]);
    expect(searchRows(rows, "t2").map((r) => r.id)).toEqual(["t2"]);
    expect(searchRows(rows, "travel").map((r) => r.id)).toEqual(["t2"]);
  });

  it("does NOT search the body", () => {
    // The body is not in the row at all — asserted so nobody "improves" search
    // by reaching back to the raw API object.
    expect(searchRows(rows, "5xK").length).toBe(0);
  });

  it("an empty query returns everything", () => {
    expect(searchRows(rows, "   ").length).toBe(2);
  });
});

describe("navigation", () => {
  it("links to /support/[id], which is where the detail route actually lives", () => {
    // NOT /support/tickets/[id] — that route does not exist, and linking to it
    // would 404 exactly as /support/new did before its static segment was added.
    expect(ticketHref("tkt_abc")).toBe("/support/tkt_abc");
  });

  it("encodes an id so it cannot break the path", () => {
    expect(ticketHref("a/b?c")).toBe("/support/a%2Fb%3Fc");
  });
});

describe("timestamps", () => {
  it("renders recent activity relatively and old activity absolutely", () => {
    expect(formatUpdated(new Date(Date.now() - 30_000).toISOString())).toBe("just now");
    expect(formatUpdated(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe("3h ago");
    // Relative to NOW, not a hardcoded date: a fixed timestamp drifts past the
    // 7-day boundary as the clock moves and the test starts failing on its own.
    const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();
    // \w{3,} not \w{3}: en-GB renders September as "Sept", four letters. A
    // three-letter assumption passes eleven months of the year and fails in one.
    expect(formatUpdated(twoWeeksAgo)).toMatch(/\d{1,2} \w{3,} \d{4}/);
  });

  it("returns empty rather than 'Invalid Date' for a bad timestamp", () => {
    expect(formatUpdated("not-a-date")).toBe("");
  });
});

describe("category labels", () => {
  it("uses the TICKET_CATEGORIES keys verbatim", () => {
    // A label map keyed on invented names ("payments", "wallet") silently falls
    // through to the raw enum value in the UI.
    expect(Object.keys(CATEGORY_LABEL).sort()).toEqual([
      "cards",
      "developers",
      "kyc",
      "other",
      "stablecoins",
      "travel",
    ]);
  });
});
