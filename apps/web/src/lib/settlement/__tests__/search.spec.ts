import { describe, expect, it, vi } from "vitest";

const sb = vi.hoisted(() => ({ queries: [] as string[] }));
vi.mock("@/lib/supabase", () => ({
  supabaseBackend: "supabase",
  sbSelect: async (_t: string, q: string) => (sb.queries.push(q), []),
  sbInsertIgnoreDuplicates: async () => undefined,
  sbUpdate: async () => [],
}));

import type { Transaction } from "@/lib/types";
import { draftSearchText, filterTransactions, transactionQuery } from "../search";
import { listRecords } from "../repository";

const tx = (id: string, over: Partial<Transaction> = {}): Transaction => ({
  id,
  category: "transfer",
  direction: "in",
  title: "Payment",
  subtitle: "",
  amountUsd: 100,
  token: "USDC",
  chain: "base",
  timestamp: "2026-10-05T12:00:00.000Z",
  status: "settled",
  ...over,
});
const q = (v: Record<string, string>) => transactionQuery.parse(v);

describe("transaction search", () => {
  const rows = [
    tx("a", { subtitle: "INV-2041 Acme Corp" }),
    tx("b", { chain: "solana", amountUsd: -75_000, direction: "out", timestamp: "2026-10-01T00:00:00.000Z" }),
    tx("c", { token: "EURC", status: "pending", timestamp: "2026-10-07T23:59:59.000Z" }),
  ];
  const ids = (v: Record<string, string>) => filterTransactions(rows, q(v)).map((t) => t.id);

  it("searches the memo/reference as well as id and title", () => {
    expect(ids({ q: "inv-2041" })).toEqual(["a"]);
  });
  it("filters by network, asset, status, direction and absolute amount", () => {
    expect(ids({ network: "solana" })).toEqual(["b"]);
    expect(ids({ asset: "EURC" })).toEqual(["c"]);
    expect(ids({ status: "pending" })).toEqual(["c"]);
    expect(ids({ direction: "out" })).toEqual(["b"]);
    expect(ids({ min: "50000" })).toEqual(["b"]);
    expect(ids({ max: "100" }).sort()).toEqual(["a", "c"]);
  });
  it("date range is inclusive of the whole end day", () => {
    expect(ids({ from: "2026-10-05", to: "2026-10-07" }).sort()).toEqual(["a", "c"]);
  });
  it("rejects reversed or malformed ranges and unknown parameters", () => {
    for (const bad of [{ from: "2026-10-07", to: "2026-10-01" }, { min: "10", max: "5" }, { from: "2026-02-30" }, { network: "Base;drop" }, { evil: "1" }])
      expect(transactionQuery.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("draft search", () => {
  it("covers customer, line items and addresses, not just the name", () => {
    const text = draftSearchText({ kind: "invoice", name: "October", customer: "Supplier Asia Ltd", dueDate: "2026-11-01", currency: "USD", lines: [{ description: "Consulting", quantity: 1, unitPrice: "10.00" }] } as never);
    expect(text).toContain("supplier asia ltd");
    expect(text).toContain("consulting");
    const ben = draftSearchText({ kind: "beneficiary", name: "Vendor", network: "base", address: "0xAbC0000000000000000000000000000000000001" } as never);
    expect(ben).toContain("0xabc0000000000000000000000000000000000001");
  });

  it("query punctuation stays inside one quoted value and cannot widen the owner scope", async () => {
    sb.queries.length = 0;
    await listRecords("owner-1", 'x",owner_id.neq.owner-1,name.ilike."*');
    const query = sb.queries[0];
    // The owner predicate is its own parameter, untouched by the search.
    expect(query.startsWith("owner_id=eq.owner-1&or=")).toBe(true);
    const or = decodeURIComponent(new URLSearchParams(query).get("or")!.replace(/\+/g, "%2B"));
    expect(or.startsWith("(")).toBe(true);
    // Every embedded quote is escaped, so the value never closes early.
    expect(or).not.toMatch(/[^\\]",owner_id/);
    expect(or).toContain(String.raw`"*x\",owner\_id.neq.owner-1,name.ilike.\"\**"`);
  });

  it("escapes LIKE wildcards so they match literally", async () => {
    sb.queries.length = 0;
    await listRecords("owner-1", "50%_off*");
    expect(decodeURIComponent(sb.queries[0])).toContain("50\\%\\_off\\*");
  });
});
