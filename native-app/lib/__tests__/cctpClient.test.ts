import {
  CCTP_DOMAINS,
  CctpError,
  attestationUrlFor,
  cctpDomainFor,
  describeCctpFee,
  fetchCctpAttestation,
  formatUsdcAtomic,
  isCctpChain,
  prepareCctpBurn,
  prepareCctpMint,
  type CctpBurnBundle,
} from "../cctp/cctpClient";
import { ApiError } from "../api";

jest.mock("../api", () => {
  const actual = jest.requireActual("../api");
  return { ...actual, api: jest.fn() };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require("../api") as { api: jest.Mock };

/** The bundle exactly as apps/web returns it. */
function serverBundle(over: Partial<CctpBurnBundle> = {}): CctpBurnBundle {
  return {
    mode: "fast",
    sourceChain: "arbitrum",
    destinationChain: "base",
    destinationDomain: 6,
    amountAtomic: "100000000",
    feeAtomic: "14000",
    feeBps: 1.4,
    maxFeeAtomic: "15400",
    transactions: [
      { to: "0xusdc", data: "0xapprove", value: "0", description: "Approve 100 USDC to TokenMessengerV2" },
      { to: "0xmessenger", data: "0xburn", value: "0", description: "Burn 100 USDC for base (domain 6)" },
    ],
    attestationPath: "/api/intents/cctp/attestation?sourceDomain=3&txHash=",
    ...over,
  };
}

beforeEach(() => api.mockReset());

describe("the burn bundle shape matches the server, not the scoping doc", () => {
  // The doc this work was scoped from described the response as
  // `{ approveTx, burnTx, feeUsd, etaSeconds, chainId }`. The server returns an
  // ordered `transactions` array and atomic fee strings. These tests pin the
  // real shape so a future rewrite against a spec sheet fails here rather than
  // at signing time, where the symptom is `undefined` passed to a signer.
  it("exposes the two legs in signing order", async () => {
    api.mockResolvedValue({ ok: true, bundle: serverBundle() });
    const b = await prepareCctpBurn({
      sourceChain: "arbitrum",
      destinationChain: "base",
      amount: 100,
      recipient: "0x" + "a".repeat(40),
    });

    expect(b.transactions).toHaveLength(2);
    expect(b.transactions[0].description).toMatch(/approve/i);
    expect(b.transactions[1].description).toMatch(/burn/i);
    // The fields the doc invented are absent. TypeScript already refuses to
    // read them off `CctpBurnBundle` — it rejected this cast until it was
    // widened through `unknown`, which is the static half of the same check.
    // Asserted at runtime as well because the type is a hand-written mirror of
    // the server, not generated from it: if the server's shape drifts, only a
    // runtime assertion notices.
    const loose = b as unknown as Record<string, unknown>;
    expect(loose.approveTx).toBeUndefined();
    expect(loose.burnTx).toBeUndefined();
    expect(loose.feeUsd).toBeUndefined();
    expect(loose.etaSeconds).toBeUndefined();
  });

  it("sends fast=true by default", async () => {
    api.mockResolvedValue({ ok: true, bundle: serverBundle() });
    await prepareCctpBurn({
      sourceChain: "arbitrum",
      destinationChain: "base",
      amount: 100,
      recipient: "0x" + "a".repeat(40),
    });
    expect(api.mock.calls[0][1].body).toMatchObject({ action: "burn", fast: true });
  });
});

describe("refusals are distinguishable", () => {
  const cases: Array<[number, Record<string, unknown>, string]> = [
    [403, { error: "amount_over_limit", detail: "cctp $600 > $500" }, "amount_over_limit"],
    [401, { error: "Unauthorized" }, "unauthenticated"],
    [429, { error: "Too many requests" }, "rate_limited"],
    [503, { error: "rail paused" }, "rail_paused"],
    [400, { error: "source and destination must differ" }, "invalid"],
  ];

  it.each(cases)("maps HTTP %i to a specific refusal", async (status, data, kind) => {
    api.mockRejectedValue(new ApiError(status, "failed", data));
    // A different source/destination so the local guard does not short-circuit.
    await expect(
      prepareCctpBurn({
        sourceChain: "arbitrum",
        destinationChain: "base",
        amount: 600,
        recipient: "0x" + "a".repeat(40),
      })
    ).rejects.toMatchObject({ refusal: { kind } });
  });

  it("does not report an unrelated 403 as the spend cap", async () => {
    // Telling a user to lower their amount when the refusal was something else
    // sends them to fix the one thing that was never wrong.
    api.mockRejectedValue(new ApiError(403, "forbidden", { error: "region_blocked" }));
    await expect(
      prepareCctpBurn({
        sourceChain: "arbitrum",
        destinationChain: "base",
        amount: 10,
        recipient: "0x" + "a".repeat(40),
      })
    ).rejects.toMatchObject({ refusal: { kind: "unknown" } });
  });

  it("refuses a same-chain transfer without a round trip", async () => {
    await expect(
      prepareCctpBurn({
        sourceChain: "base",
        destinationChain: "base",
        amount: 10,
        recipient: "0x" + "a".repeat(40),
      })
    ).rejects.toBeInstanceOf(CctpError);
    expect(api).not.toHaveBeenCalled();
  });
});

describe("domains agree with the server", () => {
  it("carries exactly the five executable corridors", () => {
    expect(CCTP_DOMAINS).toEqual({ ethereum: 0, arbitrum: 3, base: 6, polygon: 7, arc: 26 });
  });

  it("includes Arc at 26 — the domain the attestation guard used to reject", () => {
    expect(cctpDomainFor("arc")).toBe(26);
    expect(isCctpChain("arc")).toBe(true);
  });

  it("rejects a chain this app can reach but CCTP cannot settle", () => {
    // `robinhood` is a valid ChainSlug for RPC but is not a CCTP corridor.
    expect(isCctpChain("robinhood")).toBe(false);
    expect(cctpDomainFor("robinhood")).toBeUndefined();
  });

  it("polls Arc's attestation without a client-side domain error", async () => {
    api.mockResolvedValue({ status: "pending" });
    await expect(fetchCctpAttestation(26, "0x" + "b".repeat(64))).resolves.toEqual({
      status: "pending",
    });
    expect(api.mock.calls[0][0]).toContain("sourceDomain=26");
  });
});

describe("USDC amounts are formatted from atomic strings", () => {
  it("formats without floating-point division", () => {
    expect(formatUsdcAtomic("14000")).toBe("0.014");
    expect(formatUsdcAtomic("100000000")).toBe("100");
    expect(formatUsdcAtomic("0")).toBe("0");
    expect(formatUsdcAtomic("1")).toBe("0.000001");
  });

  it("survives an amount past Number.MAX_SAFE_INTEGER", () => {
    // 10 billion USDC in atomic units exceeds 2^53. Number() would round it and
    // still print something plausible, which is the dangerous failure.
    const atomic = "10000000000000000";
    expect(formatUsdcAtomic(atomic)).toBe("10000000000");
    expect(Number(atomic) > Number.MAX_SAFE_INTEGER).toBe(true);
  });

  it("returns a dash rather than throwing on a malformed value", () => {
    expect(formatUsdcAtomic("not-a-number")).toBe("—");
  });
});

describe("fee display comes from the quote", () => {
  it("reports the server's bps and atomic fee", () => {
    const f = describeCctpFee(serverBundle());
    expect(f).toMatchObject({ feeUsdc: "0.014", feeBps: 1.4, free: false, maxFeeUsdc: "0.0154" });
  });

  it("marks a genuinely free corridor as free", () => {
    // polygon -> base is 0.0 bps per Circle's published table. A client that
    // hardcoded ~1.4bps would invent a charge that is not taken.
    const f = describeCctpFee(serverBundle({ feeAtomic: "0", feeBps: 0, maxFeeAtomic: "0" }));
    expect(f.free).toBe(true);
    expect(f.feeUsdc).toBe("0");
  });
});

describe("mint leg", () => {
  it("returns the destination receiveMessage transaction", async () => {
    api.mockResolvedValue({
      ok: true,
      transaction: { to: "0xtransmitter", data: "0xreceive", value: "0", description: "Mint" },
    });
    const tx = await prepareCctpMint("0xmsg", "0xatt");
    expect(tx.to).toBe("0xtransmitter");
    expect(api.mock.calls[0][1].body).toMatchObject({ action: "mint" });
  });
});

describe("attestation url", () => {
  it("appends the burn hash to the server-built path", () => {
    const hash = "0x" + "c".repeat(64);
    expect(attestationUrlFor(serverBundle(), hash)).toBe(
      `/api/intents/cctp/attestation?sourceDomain=3&txHash=${hash}`
    );
  });
});
