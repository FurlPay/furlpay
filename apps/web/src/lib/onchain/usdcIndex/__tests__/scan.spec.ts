import { describe, expect, it } from "vitest";
import { fromHex, hllAdd, hllCount, hllMerge, newSketch, toHex } from "../hll";
import { build, decode, TRANSFER_TOPIC, type RawLog } from "../scan";
import { poolUrls } from "../rpcPool";

const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const word = (a: string) => `0x${a.replace(/^0x/, "").padStart(64, "0")}`;
const ZERO = "0x0000000000000000000000000000000000000000";
const addr = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
const txh = (i: number) => `0x${i.toString(16).padStart(64, "0")}`;
function log(block: number, logIndex: number, tx: number, from: string, to: string, amount: bigint, extra: Partial<RawLog> = {}): RawLog {
  return {
    address: USDC,
    topics: [TRANSFER_TOPIC, word(from), word(to)],
    data: `0x${amount.toString(16).padStart(64, "0")}`,
    blockNumber: `0x${block.toString(16)}`,
    blockHash: `0x${block.toString(16).padStart(64, "b")}`,
    transactionHash: txh(tx),
    transactionIndex: "0x0",
    logIndex: `0x${logIndex.toString(16)}`,
    ...extra,
  };
}

describe("HyperLogLog", () => {
  it("merge equals the sketch of the union, and is deterministic", () => {
    const a = newSketch(12), b = newSketch(12), u = newSketch(12);
    for (let i = 0; i < 5000; i++) (hllAdd(a, addr(i)), hllAdd(u, addr(i)));
    for (let i = 3000; i < 9000; i++) (hllAdd(b, addr(i)), hllAdd(u, addr(i)));
    expect(toHex(hllMerge(newSketch(12).fill(0) && hllMerge(newSketch(12), a), b))).toBe(toHex(u));
    expect(fromHex(`\\x${toHex(u)}`)).toEqual(u);
  });
  it("counts within 3 standard errors at p=12 and p=14", () => {
    for (const [p, n] of [[12, 50_000], [14, 200_000]] as const) {
      const s = newSketch(p);
      for (let i = 0; i < n; i++) hllAdd(s, addr(i * 7919 + 13));
      const err = Math.abs(hllCount(s) - n) / n;
      expect(err).toBeLessThan(3 * (1.04 / Math.sqrt(2 ** p)));
    }
  });
  it("refuses to merge sketches of different precision", () => {
    expect(() => hllMerge(newSketch(12), newSketch(14))).toThrow(/sizes differ/);
  });
});

describe("decode", () => {
  const times = new Map([[100, 1_700_000_000], [101, 1_700_000_012]]);
  it("classifies mint/burn/transfer, orders, and skips exact duplicates", () => {
    const logs = [log(101, 0, 3, addr(5), ZERO, 7n), log(100, 1, 2, addr(1), addr(2), 50n), log(100, 0, 1, ZERO, addr(1), 100n), log(100, 1, 2, addr(1), addr(2), 50n)];
    const { events, duplicates } = decode(logs, USDC, times);
    expect(duplicates).toBe(1);
    expect(events.map((e) => [e.block, e.logIndex, e.kind])).toEqual([[100, 0, 1], [100, 1, 0], [101, 0, 2]]);
  });
  it("refuses malformed, foreign, removed, conflicting or oversized logs", () => {
    expect(() => decode([log(100, 0, 1, addr(1), addr(2), 1n, { address: addr(9) })], USDC, times)).toThrow(/malformed/);
    expect(() => decode([log(100, 0, 1, addr(1), addr(2), 1n, { removed: true })], USDC, times)).toThrow(/removed/);
    expect(() => decode([log(100, 0, 1, addr(1), addr(2), 1n), log(100, 0, 1, addr(1), addr(2), 2n)], USDC, times)).toThrow(/conflicting/);
    expect(() => decode([log(100, 0, 1, addr(1), addr(2), 1n << 63n)], USDC, times)).toThrow(/refusing to truncate/);
    expect(() => decode([log(102, 0, 1, addr(1), addr(2), 1n)], USDC, times)).toThrow(/no block time/);
  });
});

describe("build", () => {
  it("hour/day/total aggregates agree exactly, tx runs are exact, digest is deterministic", () => {
    const t0 = 1_700_000_000 - (1_700_000_000 % 3600);
    const times = new Map<number, number>();
    const logs: RawLog[] = [];
    let li = 0;
    for (let b = 0; b < 600; b++) {
      times.set(1000 + b, t0 + b * 12); // spans two hours
      for (let k = 0; k < 3; k++) logs.push(log(1000 + b, li++, b * 2 + (k < 2 ? 0 : 1), k === 0 && b % 50 === 0 ? ZERO : addr(1 + (b % 97)), k === 2 && b % 60 === 0 ? ZERO : addr(1 + ((b * 3) % 89)), BigInt(b * 1000 + k)));
    }
    const { events } = decode(logs, USDC, times);
    const a = build(events, { hourSketchesSince: 0 });
    const b2 = build(decode([...logs].reverse(), USDC, times).events, { hourSketchesSince: 0 });
    expect(a.digest).toBe(b2.digest);
    expect(a.totals.events).toBe(1800);
    expect(a.totals.tx_count).toBe(1200);
    const sum = (rows: typeof a.hours, k: "transfers" | "mints" | "burns") => rows.reduce((s, r) => s + r[k], 0);
    for (const rows of [a.hours, a.days]) {
      expect(sum(rows, "transfers") + sum(rows, "mints") + sum(rows, "burns")).toBe(a.totals.events);
      expect(rows.reduce((s, r) => s + BigInt(r.transfer_raw), 0n).toString()).toBe(a.totals.transfer_raw);
    }
    expect(a.hours.length).toBe(2);
    expect(a.totals.mints).toBe(12);
    expect(a.totals.burns).toBe(10);
    const top = a.hours[0].top as unknown as string[][];
    expect(top.length).toBe(10);
    expect(BigInt(top[0][0]) >= BigInt(top[9][0])).toBe(true);
    expect(a.rows.length).toBe(1800);
    expect(a.hours[0].senders_hll.length).toBe(2 * 4096);
    expect(a.days[0].senders_hll.length).toBe(2 * 16384);
  });
  it("omits hourly sketches for hours outside the retention window", () => {
    const times = new Map([[5, 1000]]);
    const a = build(decode([log(5, 0, 1, addr(1), addr(2), 9n)], USDC, times).events, { hourSketchesSince: 10_000 });
    expect(a.hours[0].senders_hll).toBe("");
    expect(a.days[0].senders_hll.length).toBe(2 * 16384);
  });
});

describe("provider pool", () => {
  it("refuses Alchemy and non-https URLs", () => {
    process.env.USDC_INDEX_RPC_URLS = "https://eth-mainnet.g.alchemy.com/v2/x";
    expect(() => poolUrls()).toThrow(/Alchemy/);
    process.env.USDC_INDEX_RPC_URLS = "http://insecure.example";
    expect(() => poolUrls()).toThrow();
    delete process.env.USDC_INDEX_RPC_URLS;
    expect(poolUrls().every((u) => u.startsWith("https://") && !/alchemy/i.test(u))).toBe(true);
  });
});
