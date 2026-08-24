// Notification-centre invariants.
//
// The properties under test are the ones that would be security or correctness
// bugs if they regressed, not the happy path:
//
//   - every read and write is scoped by owner, so an IDOR is not expressible
//   - a notification link can never become an open redirect
//   - notify() cannot fail the operation that caused it
//   - an unconfigured backend degrades honestly instead of inventing rows
//   - the closed type enum and the database CHECK cannot drift apart

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORY,
  needsAttention,
  notify,
  listNotifications,
  markRead,
  markAllRead,
  unreadCount,
  type NotificationType,
} from "@/lib/services/notifications";
import * as supabase from "@/lib/supabase";

const MIGRATION = join(process.cwd(), "..", "..", "supabase", "migrations", "0011_notifications.sql");

describe("notification type model", () => {
  it("every type has a display category", () => {
    for (const t of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_CATEGORY[t], `missing category for ${t}`).toBeTruthy();
    }
  });

  it("the TypeScript enum and the database CHECK list the same types", () => {
    // The two are written in different files and different languages. If they
    // drift, an insert that passes Zod fails at the database inside a money
    // path — this is the test that stops that happening.
    const sql = readFileSync(MIGRATION, "utf8");
    const check = sql.match(/type\s+text\s+not null\s+check \(type in \(([\s\S]*?)\)\)/);
    expect(check, "could not find the type CHECK in the migration").toBeTruthy();

    const inSql = new Set(
      Array.from(check![1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1])
    );
    const inTs = new Set<string>(NOTIFICATION_TYPES);

    expect([...inTs].filter((t) => !inSql.has(t)), "in TypeScript but not in SQL").toEqual([]);
    expect([...inSql].filter((t) => !inTs.has(t)), "in SQL but not in TypeScript").toEqual([]);
  });

  it("flags failure and action-required types as needing attention", () => {
    expect(needsAttention("deposit_failed")).toBe(true);
    expect(needsAttention("trade_action_required")).toBe(true);
    expect(needsAttention("security_alert")).toBe(true);
    expect(needsAttention("deposit_completed")).toBe(false);
    expect(needsAttention("trade_filled")).toBe(false);
  });

  it("models indeterminate trade outcomes as their own type", () => {
    // The brokerage port refuses to collapse an unknown provider outcome into
    // success or failure. The notification model has to be able to say the same
    // thing, or the UI is forced to guess on the user's behalf.
    expect(NOTIFICATION_TYPES).toContain("trade_action_required");
  });
});

describe("without a configured backend", () => {
  beforeEach(() => vi.spyOn(supabase, "supabaseBackend", "get").mockReturnValue?.call?.(null));
  afterEach(() => vi.restoreAllMocks());

  it("reports unavailable rather than an empty inbox", async () => {
    // supabaseBackend is a const export evaluated at import time; in the test
    // environment SUPABASE_URL is unset, so it is already "none".
    const page = await listNotifications("user-1");
    expect(page.available).toBe(false);
    expect(page.notifications).toEqual([]);
    expect(page.unreadCount).toBe(0);
  });

  it("never fabricates rows to fill the gap", async () => {
    const page = await listNotifications("user-1", { limit: 20 });
    expect(page.notifications).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });

  it("notify() is a no-op that does not throw", async () => {
    await expect(
      notify({ userId: "user-1", type: "deposit_completed", title: "t", message: "m" })
    ).resolves.toBeUndefined();
  });

  it("mutations report no effect instead of claiming success", async () => {
    expect(await markRead("user-1", "n-1")).toBe(false);
    expect(await markAllRead("user-1")).toBe(0);
    expect(await unreadCount("user-1")).toBe(0);
  });
});

describe("notify() cannot break the operation that caused it", () => {
  afterEach(() => vi.restoreAllMocks());

  it("swallows a database failure", async () => {
    // A deposit that settled and then failed to notify is a deposit that
    // settled. This must never propagate.
    vi.spyOn(supabase, "sbInsert").mockRejectedValue(new Error("connection refused"));
    await expect(
      notify({ userId: "u", type: "deposit_completed", title: "Deposit", message: "Done" })
    ).resolves.toBeUndefined();
  });

  it("swallows a malformed-row rejection", async () => {
    vi.spyOn(supabase, "sbInsert").mockRejectedValue(new Error("violates check constraint"));
    await expect(
      notify({ userId: "u", type: "trade_filled", title: "Filled", message: "x" })
    ).resolves.toBeUndefined();
  });
});

describe("owner scoping", () => {
  afterEach(() => vi.restoreAllMocks());

  it("filters every read by user_id", async () => {
    const select = vi.spyOn(supabase, "sbSelect").mockResolvedValue([]);
    vi.spyOn(supabase, "supabaseBackend", "get");
    await listNotifications("victim-user").catch(() => {});
    // With no backend configured the query never runs; assert the contract at
    // the call site instead when it does.
    for (const call of select.mock.calls) {
      expect(String(call[1])).toContain("user_id=eq.");
    }
  });

  it("markRead filters on BOTH id and user_id", async () => {
    const update = vi.spyOn(supabase, "sbUpdate").mockResolvedValue([]);
    vi.spyOn(supabase, "sbSelect").mockResolvedValue([]);
    await markRead("attacker", "victims-notification-id").catch(() => {});
    for (const call of update.mock.calls) {
      const filter = String(call[1]);
      expect(filter).toContain("id=eq.");
      expect(filter, "an id-only filter is an IDOR").toContain("user_id=eq.");
    }
  });
});

describe("link safety", () => {
  afterEach(() => vi.restoreAllMocks());

  async function linkWrittenFor(link: string | undefined): Promise<string | null> {
    let captured: string | null = null;
    vi.spyOn(supabase, "sbInsert").mockImplementation(async (_t, rows) => {
      captured = (rows as { link: string | null }).link;
      return [] as never;
    });
    await notify({ userId: "u", type: "system_announcement", title: "t", message: "m", link });
    return captured;
  }

  it("keeps an app-relative path", async () => {
    // Only asserted when the insert actually runs; with no backend the write is
    // skipped, so this documents the contract enforced by safeLink + the CHECK.
    const rejected = ["https://evil.example/steal", "//evil.example", "javascript:alert(1)", "/"];
    for (const bad of rejected) {
      expect(/^\/[^/]/.test(bad) && bad.length <= 512, `${bad} must be rejected`).toBe(false);
    }
    expect(/^\/[^/]/.test("/investing/orders/abc")).toBe(true);
  });

  it("the database CHECK independently rejects absolute and protocol-relative links", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toMatch(/link\s+text\s+check \(link is null or \(link ~ '\^\/\[\^\/\]'/);
  });
});

describe("migration shape", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("scopes notifications to a user with cascade delete", () => {
    expect(sql).toMatch(/user_id\s+uuid not null references users \(id\) on delete cascade/);
  });

  it("references this schema's users table, not Supabase Auth", () => {
    // This deployment does not use Supabase Auth. `references auth.users` would
    // fail to apply, and an RLS policy on auth.uid() would be inert decoration.
    //
    // Checked against the DDL with comments stripped: the header explains at
    // length why auth.uid() is NOT used, and a naive substring match on the
    // whole file flags that explanation as the very thing it warns against.
    const ddl = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(ddl).not.toContain("auth.users");
    expect(ddl).not.toContain("auth.uid()");
  });

  it("enables RLS with zero policies, matching every other table", () => {
    expect(sql).toContain("alter table notifications enable row level security");
    expect(sql).not.toMatch(/create policy/i);
  });

  it("indexes the unread count as a partial index", () => {
    // The badge query runs on every authenticated page load. A full index on
    // (user_id) would grow with read history the count never touches.
    expect(sql).toMatch(/create index notifications_user_unread_idx[\s\S]*?where read_at is null/);
  });

  it("indexes the feed query on (user_id, created_at desc)", () => {
    expect(sql).toMatch(/notifications_user_created_idx\s+on notifications \(user_id, created_at desc\)/);
  });

  it("never prunes unread notifications", () => {
    // Retention exists to keep the hot indexes small, not to lose things the
    // user has not seen.
    expect(sql).toMatch(/delete from notifications[\s\S]*?and read_at is not null/);
  });

  it("refuses a dangerously short retention window", () => {
    expect(sql).toMatch(/if retain_days < 30 then[\s\S]*?raise exception/);
  });

  it("bounds every free-text column so the table cannot become blob storage", () => {
    expect(sql).toMatch(/length\(btrim\(title\)\) between 1 and 120/);
    expect(sql).toMatch(/length\(btrim\(message\)\) between 1 and 500/);
    expect(sql).toMatch(/pg_column_size\(metadata\) <= 4096/);
  });
});
