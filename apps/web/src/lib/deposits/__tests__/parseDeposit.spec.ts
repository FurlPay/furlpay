import { describe, expect, it } from "vitest";
import { formatUnits, parseDepositPayload, depositKey } from "../parseDeposit";

// T-W5 (audit P1-13): deposit facts are exact, and nothing is defaulted.

const base = {
  network: "ethereum",
  token: "USDC",
  decimals: 6,
  transaction: {
    hash: "0x" + "a".repeat(64),
    logIndex: 7,
    to: "0x" + "b".repeat(40),
    from: "0x" + "c".repeat(40),
    value: "2500000",
  },
};
const withTx = (t: Record<string, unknown>) => ({ ...base, transaction: { ...base.transaction, ...t } });

describe("formatUnits", () => {
  it.each([
    [10n ** 24n, 18, "1000000.000000000000000000"],
    [1n, 18, "0.000000000000000001"],
    [2500000n, 6, "2.500000"],
    [123n, 0, "123"],
    [(2n ** 53n) + 1n, 0, "9007199254740993"], // beyond float precision
  ])("%s at %i decimals → %s", (units, decimals, out) => {
    expect(formatUnits(units as bigint, decimals as number)).toBe(out);
  });
});

describe("parseDepositPayload", () => {
  it("parses exact facts", () => {
    const r = parseDepositPayload(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.facts.baseUnits).toBe(2500000n);
    expect(r.facts.amount).toBe("2.500000");
    expect(depositKey(r.facts)).toBe(`deposit:ethereum:0x${"a".repeat(64)}:7`);
  });

  it("10^24 base units at 18 decimals is exact (the old float path lost precision here)", () => {
    const r = parseDepositPayload({ ...withTx({ value: "1000000000000000000000001" }), decimals: 18 });
    expect(r.ok && r.facts.amount).toBe("1000000.000000000000000001");
    // What the old `Number(value) / 10 ** decimals` produced:
    expect(Number("1000000000000000000000001") / 10 ** 18).toBe(1000000);
  });

  it("accepts a 0x-hex base-unit string", () => {
    const r = parseDepositPayload(withTx({ value: "0x2625a0" }));
    expect(r.ok && r.facts.baseUnits).toBe(2500000n);
  });

  it.each([
    ["no network (was silently 'bsc')", { ...base, network: undefined }, "network_required"],
    ["no token (was silently 'USDT')", { ...base, token: undefined }, "token_required"],
    ["no decimals (was silently 18)", { ...base, decimals: undefined }, "decimals_required"],
    ["unsupported network", { ...base, network: "dogechain" }, "unsupported_network:dogechain"],
    ["JSON-number amount", withTx({ value: 2500000 }), "amount_must_be_base_unit_string"],
    ["decimal-string amount", withTx({ value: "2.5" }), "amount_must_be_base_unit_string"],
    ["zero amount", withTx({ value: "0" }), "amount_must_be_positive"],
    ["no log index", withTx({ logIndex: undefined }), "log_index_required"],
    ["bad tx hash", withTx({ hash: "0x123" }), "tx_hash_required"],
    ["bad recipient", withTx({ to: "nope" }), "to_address_required"],
  ])("%s → %s", (_l, payload, error) => {
    expect(parseDepositPayload(payload)).toEqual({ ok: false, error });
  });
});
