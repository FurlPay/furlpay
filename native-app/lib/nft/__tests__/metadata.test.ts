import { detectSpam, normalizeNftRow, resolveMediaUrl, sanitizeNftText } from "../metadata";
import { groupByCollection, partitionSpam, type NftItem } from "../types";

// ---------------------------------------------------------------------------
// Rendering attacker-controlled metadata.
//
// Anyone can mint a token with any name and send it to any address. Everything
// under test here is a decision about what an unsolicited stranger gets to put
// on the user's screen.
// ---------------------------------------------------------------------------

const CONTRACT = "0x1111111111111111111111111111111111111111";

describe("resolveMediaUrl", () => {
  it("rewrites ipfs:// to a gateway", () => {
    // RN's Image cannot fetch ipfs:// and renders a permanently blank box —
    // not an error, just nothing.
    expect(resolveMediaUrl("ipfs://QmHash/1.png")).toBe("https://ipfs.io/ipfs/QmHash/1.png");
  });

  it("collapses the ipfs://ipfs/ malformation", () => {
    expect(resolveMediaUrl("ipfs://ipfs/QmHash")).toBe("https://ipfs.io/ipfs/QmHash");
  });

  it("rewrites ar:// to arweave", () => {
    expect(resolveMediaUrl("ar://abc123")).toBe("https://arweave.net/abc123");
  });

  it("passes https through", () => {
    expect(resolveMediaUrl("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
  });

  // A data: URI is legal in NFT metadata and is also how content gets smuggled
  // past a content policy. javascript: is never legitimate.
  it("drops data:, javascript:, file: and http:", () => {
    for (const bad of [
      "data:image/svg+xml;base64,PHN2Zz4=",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "http://insecure.example/a.png",
      "",
      "   ",
    ]) {
      expect(resolveMediaUrl(bad)).toBeNull();
    }
  });

  it("returns null for non-strings", () => {
    expect(resolveMediaUrl(undefined)).toBeNull();
    expect(resolveMediaUrl(42)).toBeNull();
    expect(resolveMediaUrl({ url: "x" })).toBeNull();
  });
});

describe("sanitizeNftText", () => {
  it("keeps ordinary names", () => {
    expect(sanitizeNftText("Cool Cat #42")).toBe("Cool Cat #42");
  });

  it("strips bidi overrides and zero-width characters", () => {
    expect(sanitizeNftText("Bored\u202eApe")).toBe("BoredApe");
    expect(sanitizeNftText("Bo\u200bred")).toBe("Bored");
  });

  it("strips control characters including newlines", () => {
    expect(sanitizeNftText("Cool\nCat")).toBe("CoolCat");
    expect(sanitizeNftText("Cool\u0000Cat")).toBe("CoolCat");
  });

  it("caps length", () => {
    expect(sanitizeNftText("A".repeat(500))?.length).toBe(128);
  });

  it("returns null for empty and non-string input", () => {
    expect(sanitizeNftText("")).toBeNull();
    expect(sanitizeNftText("   ")).toBeNull();
    expect(sanitizeNftText(undefined)).toBeNull();
    expect(sanitizeNftText(42)).toBeNull();
  });
});

describe("detectSpam", () => {
  const clean = { name: "Cool Cat #1", description: "A cat.", collectionName: "Cool Cats", collectionVerified: false };

  it("leaves an ordinary NFT alone", () => {
    expect(detectSpam(clean)).toBeNull();
  });

  it("flags claim-bait", () => {
    expect(detectSpam({ ...clean, name: "$5000 USDC Voucher" })).not.toBeNull();
    expect(detectSpam({ ...clean, description: "Visit to claim your reward" })).not.toBeNull();
    expect(detectSpam({ ...clean, name: "Claim now!" })).not.toBeNull();
  });

  it("flags a web address in the name", () => {
    expect(detectSpam({ ...clean, name: "airdrop-evil.xyz" })).not.toBeNull();
    expect(detectSpam({ ...clean, name: "https://evil.example" })).not.toBeNull();
  });

  it("honours the indexer's own spam flag", () => {
    expect(detectSpam({ ...clean, indexerFlagged: true })).not.toBeNull();
  });

  // Marketplace verification is a stronger signal than any phrase match, and
  // flagging a verified collection would be a visible, embarrassing error.
  it("never flags a verified collection", () => {
    expect(detectSpam({ ...clean, name: "Claim your reward", collectionVerified: true })).toBeNull();
    expect(detectSpam({ ...clean, collectionVerified: true, indexerFlagged: true })).toBeNull();
  });

  // The list decides what leaves a user's main gallery. A false positive hides
  // something they bought.
  it("does not flag ordinary collection names that merely mention value", () => {
    expect(detectSpam({ ...clean, name: "Golden Ticket #3" })).toBeNull();
    expect(detectSpam({ ...clean, name: "Reward Badge" })).toBeNull();
    expect(detectSpam({ ...clean, description: "Minted at the free mint event" })).not.toBeNull();
  });

  it("returns a reason a human can read, not a boolean", () => {
    const reason = detectSpam({ ...clean, name: "Claim your USDC" });
    expect(typeof reason).toBe("string");
    expect((reason ?? "").length).toBeGreaterThan(20);
  });
});

describe("normalizeNftRow", () => {
  const row = {
    contract: CONTRACT.toUpperCase(),
    tokenId: "42",
    standard: "erc721",
    name: "Cool Cat",
    imageUrl: "ipfs://QmHash",
    collection: { name: "Cool Cats", symbol: "COOL", verified: true },
  };

  it("normalises a well-formed row", () => {
    const item = normalizeNftRow(row, "ethereum")!;
    expect(item.id).toBe(`ethereum:${CONTRACT}:42`);
    // Lowercased, so the same contract never appears as two collections.
    expect(item.contract).toBe(CONTRACT);
    expect(item.media.url).toBe("https://ipfs.io/ipfs/QmHash");
    expect(item.collection.verified).toBe(true);
    expect(item.spamReason).toBeNull();
  });

  // An item without both is not addressable, and a transfer cannot be built for
  // it — it could only disappoint whoever taps it.
  it("drops a row with no contract or no token id", () => {
    expect(normalizeNftRow({ ...row, contract: "nope" }, "ethereum")).toBeNull();
    expect(normalizeNftRow({ ...row, tokenId: "" }, "ethereum")).toBeNull();
    expect(normalizeNftRow({}, "ethereum")).toBeNull();
  });

  it("defaults to erc721 and a balance of one", () => {
    const item = normalizeNftRow({ ...row, standard: undefined, balance: undefined }, "base")!;
    expect(item.standard).toBe("erc721");
    expect(item.balance).toBe("1");
  });

  it("keeps an explicit erc1155 balance", () => {
    const item = normalizeNftRow({ ...row, standard: "erc1155", balance: "7" }, "base")!;
    expect(item.standard).toBe("erc1155");
    expect(item.balance).toBe("7");
  });

  it("rejects a non-numeric balance rather than rendering it", () => {
    expect(normalizeNftRow({ ...row, balance: "lots" }, "base")!.balance).toBe("1");
  });

  it("survives hostile field types without throwing", () => {
    const item = normalizeNftRow(
      { contract: CONTRACT, tokenId: "1", name: 42, description: {}, imageUrl: ["x"], collection: "nope" },
      "polygon",
    )!;
    expect(item.name).toBeNull();
    expect(item.media.url).toBeNull();
    expect(item.collection.name).toBeNull();
  });
});

describe("grouping and spam partitioning", () => {
  function item(over: Partial<NftItem>): NftItem {
    return {
      id: "x",
      chain: "ethereum",
      contract: CONTRACT,
      tokenId: "1",
      standard: "erc721",
      balance: "1",
      name: null,
      description: null,
      media: { url: null, thumbnailUrl: null, mimeType: null },
      collection: { contract: CONTRACT, name: "A", symbol: null, imageUrl: null, verified: false },
      spamReason: null,
      ...over,
    };
  }

  it("separates spam without discarding it", () => {
    const { clean, spam } = partitionSpam([
      item({ id: "1" }),
      item({ id: "2", spamReason: "airdrop" }),
    ]);
    // Hiding entirely would mean a user cannot see what an attacker sent them.
    expect(clean.map((i) => i.id)).toEqual(["1"]);
    expect(spam.map((i) => i.id)).toEqual(["2"]);
  });

  it("keys groups by chain AND contract", () => {
    // The same address on two chains is two collections; merging them would show
    // one group whose items cannot all be transferred on one network.
    const groups = groupByCollection([
      item({ id: "1", chain: "ethereum" }),
      item({ id: "2", chain: "base" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("puts verified collections first, then the largest", () => {
    const verified = { contract: "0xaaa", name: "V", symbol: null, imageUrl: null, verified: true };
    const big = { contract: "0xbbb", name: "B", symbol: null, imageUrl: null, verified: false };

    const groups = groupByCollection([
      item({ id: "1", contract: "0xbbb", collection: big }),
      item({ id: "2", contract: "0xbbb", collection: big }),
      item({ id: "3", contract: "0xaaa", collection: verified }),
    ]);
    expect(groups[0].collection.name).toBe("V");
    expect(groups[1].items).toHaveLength(2);
  });

  it("handles an empty list", () => {
    expect(groupByCollection([])).toEqual([]);
    expect(partitionSpam([])).toEqual({ clean: [], spam: [] });
  });
});
