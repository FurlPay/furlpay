import {
  AVATAR_COLORS,
  CONTACT_CHAINS,
  addressKey,
  addressesForChain,
  chainKind,
  chainsForAddress,
  classifyAddress,
  contactInitial,
  contactsForChain,
  defaultAddressForChain,
  duplicateAddressError,
  findContactByAddress,
  nameError,
  searchContacts,
  suggestAvatarColor,
  type Contact,
  type ContactAddress,
} from "../contacts/model";

// ---------------------------------------------------------------------------
// Address-book rules.
//
// These are the checks that decide whether a saved address is payable, and
// which one gets pre-selected when the user taps a contact mid-send. Every one
// of them has a counterpart on the server (apps/web/src/lib/contacts.ts); a
// disagreement between the two shows up as a form that passes locally and 400s
// on submit, or — much worse — a contact the app offers on a network that
// cannot receive it.
// ---------------------------------------------------------------------------

const EVM_A = "0x1111111111111111111111111111111111111111";
const EVM_B = "0x2222222222222222222222222222222222222222";
const SOL_A = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

function address(over: Partial<ContactAddress> = {}): ContactAddress {
  return {
    id: over.id ?? `a_${Math.random().toString(36).slice(2)}`,
    address: over.address ?? EVM_A,
    chain: over.chain ?? "base",
    isDefault: over.isDefault ?? false,
    ...(over.label ? { label: over.label } : {}),
  };
}

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: over.id ?? "c_1",
    name: over.name ?? "Alice",
    avatarColor: over.avatarColor ?? AVATAR_COLORS[0],
    addresses: over.addresses ?? [],
    isFavorite: over.isFavorite ?? false,
    createdAt: over.createdAt ?? 0,
    updatedAt: over.updatedAt ?? 0,
  };
}

describe("chain classification", () => {
  it("recognises EVM and Solana address shapes, and nothing else", () => {
    expect(classifyAddress(EVM_A)).toBe("evm");
    expect(classifyAddress(SOL_A)).toBe("solana");
    expect(classifyAddress("")).toBeNull();
    expect(classifyAddress("not-an-address")).toBeNull();
    // Right prefix, wrong length — the case a naive /^0x/ check would accept.
    expect(classifyAddress("0x1234")).toBeNull();
  });

  it("tolerates surrounding whitespace, because pasted text has it", () => {
    expect(classifyAddress(`  ${EVM_A}\n`)).toBe("evm");
  });

  it("offers every chain an address could belong to, and only those", () => {
    const evm = chainsForAddress(EVM_A);
    expect(evm).toContain("base");
    expect(evm).toContain("bsc");
    expect(evm).not.toContain("solana");

    // Exactly one answer for Solana, which is what lets the form pre-select it
    // instead of presenting a choice of one.
    expect(chainsForAddress(SOL_A)).toEqual(["solana"]);

    // An unpayable string offers nothing — the form's "not a valid address"
    // state falls straight out of this rather than needing a second check.
    expect(chainsForAddress("nope")).toEqual([]);
  });

  it("covers every chain the app supports", () => {
    // Guards the same drift the `satisfies` clause in model.ts guards at
    // compile time: robinhood and bsc were missing from lib/types.ts for as
    // long as they had been live.
    expect(CONTACT_CHAINS).toContain("robinhood");
    expect(CONTACT_CHAINS).toContain("bsc");
    expect(new Set(CONTACT_CHAINS).size).toBe(CONTACT_CHAINS.length);
  });

  it("puts only Solana outside the EVM family", () => {
    for (const c of CONTACT_CHAINS) {
      expect(chainKind(c)).toBe(c === "solana" ? "solana" : "evm");
    }
  });
});

describe("addressKey", () => {
  it("folds EVM case but never base58 case", () => {
    // EIP-55 is a checksum, not an identity: the same account written in two
    // casings must collapse to one key, or a duplicate slips past the check.
    expect(addressKey(EVM_A.toUpperCase().replace("0X", "0x"), "base")).toBe(
      addressKey(EVM_A, "base")
    );
    // base58 IS case-sensitive — folding it would merge two distinct accounts.
    const shouted = SOL_A.toUpperCase();
    expect(addressKey(shouted, "solana")).not.toBe(addressKey(SOL_A, "solana"));
  });

  it("scopes the key to the chain, so one address on two chains is two entries", () => {
    expect(addressKey(EVM_A, "base")).not.toBe(addressKey(EVM_A, "polygon"));
  });
});

describe("defaultAddressForChain", () => {
  it("prefers the family default", () => {
    const c = contact({
      addresses: [
        address({ id: "a1", address: EVM_A, chain: "base", isDefault: false }),
        address({ id: "a2", address: EVM_B, chain: "base", isDefault: true }),
      ],
    });
    expect(defaultAddressForChain(c, "base")?.id).toBe("a2");
  });

  it("falls back to the first address in the family when none is marked", () => {
    const c = contact({ addresses: [address({ id: "a1", chain: "arbitrum" })] });
    expect(defaultAddressForChain(c, "base")?.id).toBe("a1");
  });

  it("returns nothing rather than an address from the other family", () => {
    // The whole point: pre-selecting an EVM address for a Solana send is worse
    // than pre-selecting nothing, because it looks like an answer.
    const c = contact({ addresses: [address({ address: EVM_A, chain: "base" })] });
    expect(defaultAddressForChain(c, "solana")).toBeUndefined();
  });
});

describe("contactsForChain", () => {
  const alice = contact({
    id: "c_alice",
    name: "Alice",
    addresses: [
      address({ id: "a1", address: EVM_A, chain: "base" }),
      address({ id: "a2", address: SOL_A, chain: "solana" }),
    ],
  });
  const bob = contact({
    id: "c_bob",
    name: "Bob",
    addresses: [address({ id: "b1", address: SOL_A, chain: "solana" })],
  });

  it("drops contacts with nothing payable on the chain", () => {
    const evmOnly = contact({ id: "c_carol", name: "Carol", addresses: [address({ chain: "base" })] });
    const out = contactsForChain([alice, bob, evmOnly], "solana");
    expect(out.map((c) => c.id).sort()).toEqual(["c_alice", "c_bob"]);
  });

  it("strips the addresses that do not belong to the chain family", () => {
    const [aliceOnBase] = contactsForChain([alice], "base");
    expect(aliceOnBase.addresses.map((a) => a.id)).toEqual(["a1"]);
  });

  it("treats every EVM chain as one family", () => {
    // An address saved under `base` is still the right address to show someone
    // paying on `arbitrum` — same account, different network.
    expect(contactsForChain([alice], "arbitrum")).toHaveLength(1);
  });

  it("does not mutate the input", () => {
    contactsForChain([alice], "base");
    expect(alice.addresses).toHaveLength(2);
  });
});

describe("searchContacts", () => {
  const zoe = contact({ id: "c_z", name: "Zoe", addresses: [address({ address: EVM_A })] });
  const alice = contact({ id: "c_a", name: "Alice" });
  const bank = contact({ id: "c_b", name: "Bank", isFavorite: true });

  it("floats favourites, then sorts alphabetically", () => {
    expect(searchContacts([zoe, alice, bank], "").map((c) => c.id)).toEqual([
      "c_b",
      "c_a",
      "c_z",
    ]);
  });

  it("matches names case-insensitively", () => {
    expect(searchContacts([zoe, alice], "ALI").map((c) => c.id)).toEqual(["c_a"]);
  });

  it("matches on the address too", () => {
    // The question this answers is "is this string on my clipboard someone I
    // already know?", which a name search cannot.
    expect(searchContacts([zoe, alice], EVM_A.slice(0, 10)).map((c) => c.id)).toEqual(["c_z"]);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchContacts([zoe, alice], "qqqq")).toEqual([]);
  });
});

describe("findContactByAddress", () => {
  const alice = contact({
    id: "c_alice",
    addresses: [address({ address: EVM_A, chain: "base" })],
  });

  it("finds the owner regardless of EVM casing", () => {
    const shouted = EVM_A.toUpperCase().replace("0X", "0x");
    expect(findContactByAddress([alice], shouted, "base")?.id).toBe("c_alice");
  });

  it("will not name a contact for a chain they have no address on", () => {
    // A false confirmation here is the one this screen cannot afford: it would
    // put a trusted name next to an address that cannot receive the payment.
    expect(findContactByAddress([alice], EVM_A, "solana")).toBeUndefined();
  });

  it("returns nothing for an unknown address", () => {
    expect(findContactByAddress([alice], EVM_B, "base")).toBeUndefined();
  });
});

describe("addressesForChain", () => {
  it("returns every address in the family, not just the default", () => {
    // This is what decides whether the picker resolves immediately or opens the
    // address selector — getting it wrong pays an address the user never saw.
    const c = contact({
      addresses: [
        address({ id: "a1", address: EVM_A, chain: "base", isDefault: true }),
        address({ id: "a2", address: EVM_B, chain: "polygon" }),
        address({ id: "a3", address: SOL_A, chain: "solana" }),
      ],
    });
    expect(addressesForChain(c, "base").map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(addressesForChain(c, "solana").map((a) => a.id)).toEqual(["a3"]);
  });
});

describe("client-side validation mirrors the server's rejections", () => {
  it("rejects an empty or duplicate name before the request goes out", () => {
    const existing = [contact({ id: "c_1", name: "Alice" })];
    expect(nameError("", existing)).toMatch(/name/i);
    expect(nameError("  alice  ", existing)).toMatch(/already have/i);
    expect(nameError("Bob", existing)).toBeNull();
  });

  it("lets a contact keep its own name while editing", () => {
    const existing = [contact({ id: "c_1", name: "Alice" })];
    expect(nameError("Alice", existing, "c_1")).toBeNull();
  });

  it("rejects a name past the server's length cap", () => {
    expect(nameError("x".repeat(65), [])).toMatch(/at most/i);
    expect(nameError("x".repeat(64), [])).toBeNull();
  });

  it("catches a duplicate address on the same contact, per chain", () => {
    const c = contact({ addresses: [address({ address: EVM_A, chain: "base" })] });
    expect(duplicateAddressError(c, EVM_A, "base")).toMatch(/already saved/i);
    // Same address, different network, is a legitimate second entry.
    expect(duplicateAddressError(c, EVM_A, "polygon")).toBeNull();
    expect(duplicateAddressError(c, EVM_B, "base")).toBeNull();
  });
});

describe("presentation helpers", () => {
  it("never renders a blank avatar", () => {
    expect(contactInitial("alice")).toBe("A");
    expect(contactInitial("   ")).toBe("?");
    expect(contactInitial("")).toBe("?");
  });

  it("only ever suggests a colour the API accepts", () => {
    for (let n = 0; n < AVATAR_COLORS.length * 2 + 1; n++) {
      const suggested = suggestAvatarColor(Array.from({ length: n }, () => contact()));
      expect(AVATAR_COLORS).toContain(suggested);
    }
  });

  it("cycles the palette so consecutive contacts differ", () => {
    const first = suggestAvatarColor([]);
    const second = suggestAvatarColor([contact()]);
    expect(first).not.toBe(second);
  });
});
