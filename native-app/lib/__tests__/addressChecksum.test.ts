import { isAddress, isNonZeroAddress, parseAtomic } from "../swap/validatePlan";
import {
  addSwapEventSink,
  clearSwapEventSinks,
  recordSwapEvent,
  type SwapEvent,
} from "../swap/telemetry";

// ---------------------------------------------------------------------------
// EIP-55, implemented on @noble/hashes because this app has no viem or ethers —
// the wallet is built directly on @noble/curves, which is why lib/evm also
// hand-rolls RLP and EIP-1559.
//
// The vectors below are the canonical ones from the EIP-55 spec itself.
// ---------------------------------------------------------------------------

describe("EIP-55 checksum", () => {
  // Straight from ERC-55's "Test Cases" section.
  const CANONICAL = [
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
    "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
    "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  ];

  it("accepts correctly checksummed addresses", () => {
    for (const address of CANONICAL) {
      expect(isAddress(address)).toBe(true);
    }
  });

  it("rejects a mixed-case address whose checksum is wrong", () => {
    // One character's case flipped. This is the typo EIP-55 exists to catch,
    // and the whole reason a length-only regex is not enough.
    for (const address of CANONICAL) {
      const body = address.slice(2);
      const i = body.search(/[a-fA-F]/);
      const flipped =
        body[i] === body[i].toUpperCase() ? body[i].toLowerCase() : body[i].toUpperCase();
      const broken = "0x" + body.slice(0, i) + flipped + body.slice(i + 1);
      expect(isAddress(broken)).toBe(false);
    }
  });

  it("accepts all-lowercase and all-uppercase — neither claims a checksum", () => {
    // Getting this inverted turns a safety check into an outage: lowercase is
    // what plenty of explorers and APIs emit, and EIP-55 says it is valid.
    for (const address of CANONICAL) {
      expect(isAddress(address.toLowerCase())).toBe(true);
      expect(isAddress("0x" + address.slice(2).toUpperCase())).toBe(true);
    }
  });

  it("still rejects the wrong shape", () => {
    for (const bad of ["0x123", "", "not-an-address", "0x" + "z".repeat(40), null, 42]) {
      expect(isAddress(bad)).toBe(false);
    }
  });

  it("treats the zero address as never a counterparty", () => {
    expect(isAddress("0x" + "0".repeat(40))).toBe(true); // well-formed…
    expect(isNonZeroAddress("0x" + "0".repeat(40))).toBe(false); // …but never valid
  });
});

describe("parseAtomic", () => {
  it("parses ordinary amounts", () => {
    expect(parseAtomic("1000000")).toBe(1000000n);
    expect(parseAtomic("0")).toBe(0n);
  });

  it("returns null instead of throwing on junk", () => {
    // BigInt() throws, and a throw from inside a validator is a crash rather
    // than a rejection the user can read.
    for (const bad of ["1e6", "-1", "1.5", "0x10", "", " 1 ", null, undefined, 5]) {
      expect(parseAtomic(bad)).toBeNull();
    }
  });

  it("refuses a value above uint256 rather than overflowing an approve()", () => {
    expect(parseAtomic("9".repeat(78))).toBeNull();
    expect(parseAtomic("9".repeat(200))).toBeNull();
  });
});

describe("swap telemetry", () => {
  afterEach(clearSwapEventSinks);

  it("truncates hashes so logs can't be pivoted on", () => {
    const seen: SwapEvent[] = [];
    addSwapEventSink((e) => seen.push(e));

    recordSwapEvent({
      name: "swap.broadcast",
      routeId: "route-1",
      txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    });

    expect(seen[0].txHash).toBe("0x12345678…abcdef");
    // The route id is the whole point of the event and is not sensitive.
    expect(seen[0].routeId).toBe("route-1");
  });

  it("never lets a broken sink fail a swap", () => {
    // The user's money is not contingent on our logging working.
    addSwapEventSink(() => {
      throw new Error("sentry is down");
    });
    const seen: SwapEvent[] = [];
    addSwapEventSink((e) => seen.push(e));

    expect(() => recordSwapEvent({ name: "swap.quote" })).not.toThrow();
    expect(seen).toHaveLength(1); // the healthy sink still received it
  });
});
