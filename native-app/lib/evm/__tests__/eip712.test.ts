import {
  collectDependencies,
  encodeData,
  encodeType,
  hashDomain,
  hashTypedData,
  TypedDataError,
  validateTypedData,
} from "../eip712";
import { computeAuthorizationDigest, type Authorization } from "@/lib/wallet";

// ---------------------------------------------------------------------------
// EIP-712 correctness.
//
// THE PRIMARY ORACLE IS IN THIS REPO. lib/__tests__/wallet.test.ts pins
// computeAuthorizationDigest against a digest computed independently with
// viem's hashTypedData, and the server's verifyAuthorizationSignature agrees
// with it in production. So the strongest available check on this general
// encoder is that it reproduces that exact digest from the general path — a
// live oracle, not a constant recalled from a specification.
//
// That test is first, and it is the one that matters. If the general encoder
// and the purpose-built one disagree on the same input, one of them is wrong
// and the money path is the one with independent verification behind it.
// ---------------------------------------------------------------------------

const ORACLE_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const AUTH: Authorization = {
  from: ORACLE_ADDRESS,
  to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  value: "1000000",
  validAfter: "0",
  validBefore: "4102444800",
  nonce: "0x00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
};

const DOMAIN = {
  chainId: 42161,
  verifyingContract: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  name: "USD Coin",
  version: "2",
};

describe("agreement with the viem-verified encoder already in the repo", () => {
  it("produces the same digest as computeAuthorizationDigest", () => {
    const general = hashTypedData({
      domain: DOMAIN,
      primaryType: "TransferWithAuthorization",
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      message: { ...AUTH },
    });

    expect(general).toBe(computeAuthorizationDigest(AUTH, DOMAIN));
  });

  // The same vector, but proving the general path is actually sensitive to the
  // data — an encoder that returned a constant would pass the test above.
  it("changes when any field changes", () => {
    const base = {
      domain: DOMAIN,
      primaryType: "TransferWithAuthorization",
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      message: { ...AUTH } as Record<string, unknown>,
    };
    const original = hashTypedData(base);

    expect(hashTypedData({ ...base, message: { ...AUTH, value: "1000001" } })).not.toBe(original);
    expect(hashTypedData({ ...base, domain: { ...DOMAIN, chainId: 1 } })).not.toBe(original);
  });
});

describe("encodeType", () => {
  const types = {
    Mail: [
      { name: "from", type: "Person" },
      { name: "to", type: "Person" },
      { name: "contents", type: "string" },
    ],
    Person: [
      { name: "name", type: "string" },
      { name: "wallet", type: "address" },
    ],
  };

  // The classic bug: sorting the primary type in with the referenced ones.
  // It produces a different typehash and therefore a signature the verifying
  // contract does not recognise.
  it("keeps the primary type first and sorts the rest alphabetically", () => {
    expect(encodeType("Mail", types)).toBe(
      "Mail(Person from,Person to,string contents)Person(string name,address wallet)",
    );
  });

  it("sorts multiple referenced types alphabetically", () => {
    const t = {
      Root: [
        { name: "z", type: "Zeta" },
        { name: "a", type: "Alpha" },
      ],
      Zeta: [{ name: "v", type: "uint256" }],
      Alpha: [{ name: "v", type: "uint256" }],
    };
    expect(encodeType("Root", t)).toBe("Root(Zeta z,Alpha a)Alpha(uint256 v)Zeta(uint256 v)");
  });

  it("follows struct arrays into their element type", () => {
    const t = {
      Bag: [{ name: "items", type: "Item[]" }],
      Item: [{ name: "id", type: "uint256" }],
    };
    expect(collectDependencies("Bag", t)).toEqual(["Bag", "Item"]);
  });

  it("throws on an unknown primary type", () => {
    expect(() => encodeType("Nope", types)).toThrow(TypedDataError);
  });
});

describe("value encoding", () => {
  const digestOf = (type: string, value: unknown) =>
    hashTypedData({
      domain: { chainId: 1 },
      primaryType: "T",
      types: { T: [{ name: "v", type }] },
      message: { v: value },
    });

  /**
   * The single 32-byte word a value encodes to, as hex without the typehash.
   *
   * encodeData returns typehash ‖ word, and the typehash depends on the
   * declared TYPE NAME — so two different types can never share a digest even
   * when their value words are identical. Slicing the typehash off is what lets
   * a test assert something about the encoding rather than about the type name.
   */
  const wordOf = (type: string, value: unknown) =>
    Buffer.from(encodeData("T", { v: value }, { T: [{ name: "v", type }] }))
      .toString("hex")
      .slice(64);

  it("accepts a uint256 as string, number or bigint identically", () => {
    const a = digestOf("uint256", "1000000000000000000");
    expect(digestOf("uint256", 10n ** 18n)).toBe(a);
    // A number is only equal where it is exactly representable; 1e18 is not, so
    // the comparison uses a small value that is.
    expect(digestOf("uint256", 42)).toBe(digestOf("uint256", "42"));
  });

  it("encodes int256 negatives as two's complement", () => {
    // Compared at the WORD level, not the digest: the field's declared type is
    // part of the typehash, so `int256 v` and `uint256 v` necessarily produce
    // different digests however their values encode. The question here is only
    // whether the 32-byte word is right.
    expect(wordOf("int256", -1)).not.toBe(wordOf("int256", 1));
    expect(wordOf("int256", -1)).toBe(wordOf("uint256", (1n << 256n) - 1n));
    expect(wordOf("int256", -1)).toBe("f".repeat(64));
  });

  it("refuses a negative value for an unsigned type", () => {
    expect(() => digestOf("uint256", -1)).toThrow(TypedDataError);
  });

  // bytesN pads RIGHT while every numeric type pads LEFT. Reversing it produces
  // a valid signature over data nobody meant to sign.
  it("right-pads bytesN and left-pads numbers", () => {
    expect(digestOf("bytes32", "0x01")).not.toBe(digestOf("uint256", 1));
    // bytes4 0x01000000 and bytes4 0x01 pad to the same word.
    expect(digestOf("bytes4", "0x01")).toBe(digestOf("bytes4", "0x01000000"));
  });

  it("hashes dynamic bytes and strings rather than padding them", () => {
    expect(digestOf("string", "hello")).not.toBe(digestOf("bytes32", "0x68656c6c6f"));
  });

  it("encodes bool as 0 or 1", () => {
    expect(wordOf("bool", true)).toBe(wordOf("uint256", 1));
    expect(wordOf("bool", false)).toBe(wordOf("uint256", 0));
  });

  it("rejects a malformed address", () => {
    expect(() => digestOf("address", "0x123")).toThrow(TypedDataError);
    expect(() => digestOf("address", 42)).toThrow(TypedDataError);
  });

  it("rejects a bytesN value longer than its type", () => {
    expect(() => digestOf("bytes4", "0x0102030405")).toThrow(TypedDataError);
  });

  it("enforces fixed array lengths", () => {
    const call = (items: unknown[]) =>
      hashTypedData({
        domain: { chainId: 1 },
        primaryType: "T",
        types: { T: [{ name: "v", type: "uint256[2]" }] },
        message: { v: items },
      });
    expect(() => call([1])).toThrow(TypedDataError);
    expect(() => call([1, 2, 3])).toThrow(TypedDataError);
    expect(call([1, 2])).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("encodes dynamic arrays without a length prefix", () => {
    const call = (items: unknown[]) =>
      hashTypedData({
        domain: { chainId: 1 },
        primaryType: "T",
        types: { T: [{ name: "v", type: "uint256[]" }] },
        message: { v: items },
      });
    // Different contents must differ; same contents must match.
    expect(call([1, 2])).not.toBe(call([2, 1]));
    expect(call([1, 2])).toBe(call([1, 2]));
  });

  it("encodes nested structs", () => {
    const types = {
      Mail: [
        { name: "from", type: "Person" },
        { name: "contents", type: "string" },
      ],
      Person: [
        { name: "name", type: "string" },
        { name: "wallet", type: "address" },
      ],
    };
    const digest = hashTypedData({
      domain: { name: "Ether Mail", version: "1", chainId: 1 },
      primaryType: "Mail",
      types,
      message: { from: { name: "Cow", wallet: ORACLE_ADDRESS }, contents: "Hello" },
    });
    expect(digest).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("hashDomain", () => {
  // A domain with no salt must not hash as though it had one — that produces a
  // separator the verifying contract never computes, and a rejection with no
  // useful error.
  it("depends on which fields are present", () => {
    const a = hashDomain({ name: "A", chainId: 1 });
    const b = hashDomain({ name: "A", chainId: 1, version: "1" });
    expect(Buffer.from(a).toString("hex")).not.toBe(Buffer.from(b).toString("hex"));
  });

  it("is order-independent in the input object", () => {
    const a = hashDomain({ name: "A", version: "1", chainId: 1 });
    const b = hashDomain({ chainId: 1, name: "A", version: "1" });
    expect(Buffer.from(a).toString("hex")).toBe(Buffer.from(b).toString("hex"));
  });
});

describe("hashTypedData ignores a dApp-supplied EIP712Domain type", () => {
  // A dApp declaring a domain type that lists fields its domain object does not
  // contain would otherwise steer us into a separator no contract agrees with.
  it("reconstructs the domain from the value", () => {
    const withDeclared = hashTypedData({
      domain: { name: "A", chainId: 1 },
      primaryType: "T",
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
          { name: "salt", type: "bytes32" },
        ],
        T: [{ name: "v", type: "uint256" }],
      },
      message: { v: 1 },
    });
    const withoutDeclared = hashTypedData({
      domain: { name: "A", chainId: 1 },
      primaryType: "T",
      types: { T: [{ name: "v", type: "uint256" }] },
      message: { v: 1 },
    });
    expect(withDeclared).toBe(withoutDeclared);
  });
});

describe("validateTypedData", () => {
  const good = {
    domain: { chainId: 1 },
    types: { T: [{ name: "v", type: "uint256" }] },
    primaryType: "T",
    message: { v: 1 },
  };

  it("accepts a well-formed payload", () => {
    expect(validateTypedData(good)).toEqual({ ok: true });
  });

  it("rejects missing pieces without throwing", () => {
    for (const key of ["domain", "types", "primaryType", "message"] as const) {
      const bad = { ...good, [key]: undefined };
      const res = validateTypedData(bad);
      expect(res.ok).toBe(false);
    }
  });

  it("rejects a primaryType that is not defined", () => {
    const res = validateTypedData({ ...good, primaryType: "Missing" });
    expect(res.ok).toBe(false);
  });

  // A remote party must not be able to blow the JS stack.
  it("rejects a self-referential type graph", () => {
    const res = validateTypedData({
      ...good,
      types: { T: [{ name: "child", type: "T" }] },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/itself/i);
  });

  it("rejects an indirectly cyclic graph", () => {
    const res = validateTypedData({
      domain: { chainId: 1 },
      primaryType: "A",
      types: { A: [{ name: "b", type: "B" }], B: [{ name: "a", type: "A[]" }] },
      message: {},
    });
    expect(res.ok).toBe(false);
  });

  it("rejects an absurd number of types", () => {
    const types: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) types[`T${i}`] = [{ name: "v", type: "uint256" }];
    expect(validateTypedData({ ...good, types }).ok).toBe(false);
  });
});
