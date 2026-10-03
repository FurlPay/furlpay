import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// FP-SET-16: concurrent execute / refund on the legacy /api/payments store.
//
// settle() and the refund path await the ledger BEFORE writing the terminal
// status. Two requests on one payment therefore both passed the status check,
// and both posted to the ledger. These tests hold the ledger call open so the
// second request lands exactly in that window.
// ---------------------------------------------------------------------------

let releaseLedger: () => void = () => {};
const recordPaymentWithFee = vi.fn(
  () => new Promise<{ id: string }>((resolve) => (releaseLedger = () => resolve({ id: `ltx_${recordPaymentWithFee.mock.calls.length}` }))),
);
const reverseLedgerTx = vi.fn(
  () => new Promise<{ id: string }>((resolve) => (releaseLedger = () => resolve({ id: "ltx_reversal" }))),
);

vi.mock("@/lib/ledger", async () => ({
  ...(await vi.importActual<typeof import("@/lib/ledger")>("@/lib/ledger")),
  recordPaymentWithFee: () => recordPaymentWithFee(),
  reverseLedgerTx: () => reverseLedgerTx(),
}));

import { createPayment, executePayment, getPayment, refundPayment } from "@/lib/services/payments";

const SIG = `0x${"1".repeat(130)}`;
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  recordPaymentWithFee.mockClear();
  reverseLedgerTx.mockClear();
});

async function newPayment() {
  const { record } = await createPayment({ amount: 10, sourceChain: "arbitrum", recipient: RECIPIENT, userId: "user-a" });
  return record.id;
}

describe("FP-SET-16: one payment settles once under concurrent execute", () => {
  it("the second execute, arriving while the first awaits the ledger, is refused and posts nothing", async () => {
    const id = await newPayment();
    const first = executePayment(id, "0x1111111111111111111111111111111111111111", SIG, "user-a");
    await tick(); // first is now parked inside the ledger call
    const second = await executePayment(id, "0x3333333333333333333333333333333333333333", SIG, "user-b");
    expect(second).toMatchObject({ ok: false, status: 409, error: "payment_in_flight" });

    releaseLedger();
    expect((await first).ok).toBe(true);
    expect(recordPaymentWithFee).toHaveBeenCalledTimes(1);
    // The second caller did not overwrite who paid.
    expect(getPayment(id)).toMatchObject({ status: "settled", payerUserId: "user-a" });
  });

  it("after a settlement completes, a retry replays instead of posting", async () => {
    const id = await newPayment();
    const p = executePayment(id, "0x1111111111111111111111111111111111111111", SIG, "user-a");
    await tick();
    releaseLedger();
    await p;
    const replay = await executePayment(id, "0x1111111111111111111111111111111111111111", SIG, "user-a");
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(recordPaymentWithFee).toHaveBeenCalledTimes(1);
  });

  it("a failed ledger post releases the claim so the payment can be retried", async () => {
    const id = await newPayment();
    recordPaymentWithFee.mockImplementationOnce(() => Promise.reject(new Error("ledger down")));
    expect(await executePayment(id, "0x1111111111111111111111111111111111111111", SIG, "user-a")).toMatchObject({ ok: false, error: "ledger_error" });
    const retry = executePayment(id, "0x1111111111111111111111111111111111111111", SIG, "user-a");
    await tick();
    releaseLedger();
    expect((await retry).ok).toBe(true);
  });
});

describe("FP-SET-16: one payment refunds once under concurrent refund", () => {
  it("the second refund is refused while the first reversal is in flight", async () => {
    const id = await newPayment();
    const s = executePayment(id, "0x1111111111111111111111111111111111111111", SIG, "user-a");
    await tick();
    releaseLedger();
    await s;

    const first = refundPayment(id, "user-a");
    await tick();
    const second = await refundPayment(id, "user-a");
    expect(second).toMatchObject({ ok: false, status: 409, error: "refund_in_flight" });
    releaseLedger();
    expect((await first).ok).toBe(true);
    expect(reverseLedgerTx).toHaveBeenCalledTimes(1);
    expect(getPayment(id)?.status).toBe("refunded");
  });
});
