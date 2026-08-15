// "Recently paid", derived from the payments ledger.
//
// Two rules carry the weight: a blocked payment is never re-offered (that would
// undo the compliance decision one tap from the amount field), and a row whose
// recipient is not payable on the chain it was sent on is dropped rather than
// repaired (offering it puts a guaranteed failure at the top of the send sheet).

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { summarizeRecentRecipients, recentsForChain } from "@/lib/recentRecipients";
import { createContact } from "@/lib/contacts";
import { findOrCreateUserByIdentity, type UserAccount } from "@/lib/store";
import type { PaymentRow, PaymentStatus } from "@/lib/paymentsDb";

const EVM = "0x7045E4f6C1B5EDf8b0C6b9d3D6bE9E4E1FAAa31e";
const EVM2 = "0x1111111111111111111111111111111111111111";
const SOL = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";

function account(): UserAccount {
  const { account } = findOrCreateUserByIdentity({
    email: `recent-${randomUUID()}@furlpay.test`,
    name: "Recent User",
  });
  account.contacts = [];
  return account;
}

function row(over: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: randomUUID(),
    created_by_user_id: "u",
    status: "settled" as PaymentStatus,
    amount_usdc: "10",
    source_chain: "arbitrum",
    recipient: EVM,
    expires_at: "2026-09-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

describe("summarizeRecentRecipients", () => {
  it("collapses repeat payments into one entry, most recent first", () => {
    const out = summarizeRecentRecipients(account(), [
      row({ recipient: EVM, created_at: "2026-08-01T00:00:00.000Z" }),
      row({ recipient: EVM, created_at: "2026-08-05T00:00:00.000Z" }),
      row({ recipient: EVM2, created_at: "2026-08-09T00:00:00.000Z" }),
    ]);

    expect(out).toHaveLength(2);
    expect(out[0].address).toBe(EVM2);
    expect(out[1].address).toBe(EVM);
    expect(out[1].count).toBe(2);
    expect(out[1].lastPaidAt).toBe("2026-08-05T00:00:00.000Z");
  });

  it("counts EVM addresses case-insensitively but Solana exactly", () => {
    const evm = summarizeRecentRecipients(account(), [
      row({ recipient: EVM }),
      row({ recipient: EVM.toLowerCase() }),
    ]);
    expect(evm).toHaveLength(1);
    expect(evm[0].count).toBe(2);

    // base58 is case-SENSITIVE. Lowercasing this key happens to produce another
    // perfectly valid 32-byte address — a DIFFERENT wallet. Folding the two
    // together would report payments to one as payments to the other, so they
    // must stay separate.
    const lowered = SOL.toLowerCase();
    expect(lowered).not.toBe(SOL);
    const sol = summarizeRecentRecipients(account(), [
      row({ recipient: SOL, source_chain: "solana" }),
      row({ recipient: lowered, source_chain: "solana" }),
    ]);
    expect(sol).toHaveLength(2);
    expect(sol.every((r) => r.count === 1)).toBe(true);
  });

  it("never re-offers a blocked recipient", () => {
    const out = summarizeRecentRecipients(account(), [
      row({ recipient: EVM, status: "blocked", blocked_reason: "sanctions" }),
    ]);
    expect(out).toEqual([]);
  });

  it("drops an expired intent but keeps one still in flight", () => {
    const out = summarizeRecentRecipients(account(), [
      row({ recipient: EVM, status: "expired" }),
      row({ recipient: EVM2, status: "pending_signature" }),
    ]);
    expect(out.map((r) => r.address)).toEqual([EVM2]);
  });

  it("drops a row whose recipient is not payable on its chain", () => {
    const out = summarizeRecentRecipients(account(), [
      // A Solana key recorded against an EVM chain cannot be re-sent to.
      row({ recipient: SOL, source_chain: "arbitrum" }),
      row({ recipient: EVM, source_chain: "solana" }),
      row({ recipient: "not-an-address", source_chain: "base" }),
    ]);
    expect(out).toEqual([]);
  });

  it("drops a chain the app does not know", () => {
    const out = summarizeRecentRecipients(account(), [row({ source_chain: "fantom" })]);
    expect(out).toEqual([]);
  });

  it("attributes the payment to the SETTLEMENT chain when there is one", () => {
    const out = summarizeRecentRecipients(account(), [
      row({ source_chain: "base", settlement_chain: "arbitrum", settled_at: "2026-08-07T00:00:00.000Z" }),
    ]);
    expect(out[0].chain).toBe("arbitrum");
    expect(out[0].lastPaidAt).toBe("2026-08-07T00:00:00.000Z");
  });

  it("annotates a recipient that is already a saved contact", () => {
    const a = account();
    const created = createContact(a, {
      name: "Alice",
      avatarColor: "#3B82F6",
      // Saved on Base; paid on Arbitrum. Same address, same family.
      addresses: [{ address: EVM, chain: "arbitrum" }],
    });
    if (!created.ok) throw new Error("setup failed");

    const out = summarizeRecentRecipients(a, [row({ recipient: EVM, source_chain: "arbitrum" })]);
    expect(out[0].contact).toEqual({ id: created.value.id, name: "Alice", avatarColor: "#3B82F6" });
  });

  it("honours the limit", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ recipient: `0x${String(i).repeat(40)}`.slice(0, 42) })
    );
    expect(summarizeRecentRecipients(account(), rows, 2)).toHaveLength(2);
  });
});

describe("recentsForChain", () => {
  it("filters by chain FAMILY, not by exact chain", () => {
    const all = summarizeRecentRecipients(account(), [
      row({ recipient: EVM, source_chain: "arbitrum" }),
      row({ recipient: SOL, source_chain: "solana" }),
    ]);

    // An EVM address saved against Arbitrum is payable on Base too.
    expect(recentsForChain(all, "base").map((r) => r.address)).toEqual([EVM]);
    expect(recentsForChain(all, "solana").map((r) => r.address)).toEqual([SOL]);
  });
});
