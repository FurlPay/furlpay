import { bytesToHex, encode, hexToBytes, toBigInt, toMinimalBytes } from "../evm/rlp";

// ---------------------------------------------------------------------------
// Canonical RLP vectors from the Ethereum Yellow Paper (Appendix B) and the
// long-standing ethereum/tests fixtures.
//
// These are external ground truth, not values captured from this
// implementation. That distinction is the point: a characterization test that
// records whatever the code currently emits would have happily locked in a
// non-minimal integer encoding, and every transaction signed afterwards would
// hash to something no node accepts.
// ---------------------------------------------------------------------------

const utf8 = (s: string) => new TextEncoder().encode(s);
const hex = (input: Parameters<typeof encode>[0]) => bytesToHex(encode(input));

describe("RLP — canonical vectors", () => {
  it("encodes short strings", () => {
    expect(hex(utf8("dog"))).toBe("0x83646f67");
    // Empty string is 0x80, and is also how zero is encoded.
    expect(hex(utf8(""))).toBe("0x80");
  });

  it("encodes a single byte below 0x80 as itself", () => {
    // No length prefix. Getting this wrong shifts every byte after it.
    expect(hex(Uint8Array.of(0x0f))).toBe("0x0f");
    expect(hex(Uint8Array.of(0x00))).toBe("0x00");
    // 0x80 is the boundary — it does take a prefix.
    expect(hex(Uint8Array.of(0x80))).toBe("0x8180");
  });

  it("encodes lists", () => {
    expect(hex([])).toBe("0xc0");
    expect(hex([utf8("cat"), utf8("dog")])).toBe("0xc88363617483646f67");
    // The "set theoretical representation of three": [ [], [[]], [ [], [[]] ] ]
    expect(hex([[], [[]], [[], [[]]]])).toBe("0xc7c0c1c0c3c0c1c0");
  });

  it("switches to the long form above 55 bytes", () => {
    const lorem =
      "Lorem ipsum dolor sit amet, consectetur adipisicing elit";
    expect(lorem.length).toBe(56);
    // 0xb8 = 0xb7 + 1 length byte, then 0x38 = 56.
    expect(hex(utf8(lorem)).startsWith("0xb838")).toBe(true);
  });

  it("encodes integers minimally, with zero as the empty string", () => {
    // The rule that matters most: 0 is 0x80 (empty), NOT 0x00.
    expect(bytesToHex(toMinimalBytes(0n))).toBe("0x");
    expect(bytesToHex(toMinimalBytes(1n))).toBe("0x01");
    expect(bytesToHex(toMinimalBytes(15n))).toBe("0x0f");
    expect(bytesToHex(toMinimalBytes(1024n))).toBe("0x0400"); // never 0x000400
    expect(bytesToHex(toMinimalBytes(255n))).toBe("0xff");
    expect(bytesToHex(toMinimalBytes(256n))).toBe("0x0100");
  });

  it("refuses a negative integer rather than encoding nonsense", () => {
    expect(() => toMinimalBytes(-1n)).toThrow();
  });
});

describe("hex helpers", () => {
  it("round-trips", () => {
    expect(bytesToHex(hexToBytes("0xdeadbeef"))).toBe("0xdeadbeef");
    expect(hexToBytes("0x")).toHaveLength(0);
    expect(hexToBytes("")).toHaveLength(0);
  });

  it("rejects non-hex instead of silently producing NaN bytes", () => {
    expect(() => hexToBytes("0xzz")).toThrow();
  });

  it("reads quantities beyond 2^53 without rounding", () => {
    // Gas and wei values routinely exceed Number's safe range. Rounding a
    // `value` here would move a different amount than the one quoted.
    const huge = "0xffffffffffffffffff"; // 2^72 - 1
    expect(toBigInt(huge)).toBe(4722366482869645213695n);
    expect(toBigInt("0x0")).toBe(0n);
    expect(toBigInt(undefined)).toBe(0n);
    expect(toBigInt("")).toBe(0n);
  });

  it("refuses an unsafe JS number rather than rounding it", () => {
    expect(() => toBigInt(2 ** 53 + 1)).toThrow(/safe integer/i);
  });
});
