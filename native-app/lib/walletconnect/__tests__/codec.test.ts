import { flattenNamespaces, toDappMetadata, toProposal, toRequest, toSession } from "../codec";
import type { WalletKitTypes } from "@reown/walletkit";

// ---------------------------------------------------------------------------
// SDK translation.
//
// Every failure this file guards against is SILENT — the app keeps running and
// shows the user something subtly wrong:
//
//   - chains read from only one of the two legal places  -> "this site asked
//     for no supported network" for a site asking for Ethereum
//   - an expiry read in seconds as milliseconds          -> nothing ever expires
//   - verifyContext dropped                              -> the confirmation
//     screen loses its only anti-phishing signal
//
// None of these throws, so only a test catches them.
// ---------------------------------------------------------------------------

const ADDR = "0x1111111111111111111111111111111111111111";

describe("flattenNamespaces", () => {
  it("reads chains from the `chains` array", () => {
    const out = flattenNamespaces({
      eip155: { chains: ["eip155:1", "eip155:137"], methods: ["personal_sign"], events: ["chainChanged"] },
    });
    expect(out.chains).toEqual(["eip155:1", "eip155:137"]);
    expect(out.methods).toEqual(["personal_sign"]);
    expect(out.events).toEqual(["chainChanged"]);
  });

  // The form that gets dropped by naive translators. A single-chain proposal is
  // commonly written with the chain in the KEY and no `chains` array at all.
  it("reads a chain implied by a CAIP-2 namespace key", () => {
    const out = flattenNamespaces({
      "eip155:1": { methods: ["eth_sendTransaction"], events: [] },
    });
    expect(out.chains).toEqual(["eip155:1"]);
    expect(out.methods).toEqual(["eth_sendTransaction"]);
  });

  it("merges both forms without duplicating", () => {
    const out = flattenNamespaces({
      "eip155:1": { chains: ["eip155:1", "eip155:8453"], methods: ["personal_sign"] },
      eip155: { chains: ["eip155:1"], methods: ["personal_sign", "eth_sendTransaction"] },
    });
    expect(new Set(out.chains)).toEqual(new Set(["eip155:1", "eip155:8453"]));
    expect(out.chains.length).toBe(2);
    expect(new Set(out.methods)).toEqual(new Set(["personal_sign", "eth_sendTransaction"]));
  });

  it("does not treat a bare namespace key as a chain", () => {
    // "eip155" alone is a namespace, not a chain id — adding it would produce
    // an un-parseable chain that policy.ts would reject as unsupported.
    const out = flattenNamespaces({ eip155: { methods: ["personal_sign"] } });
    expect(out.chains).toEqual([]);
  });

  it("survives undefined, empty and partial namespaces", () => {
    expect(flattenNamespaces(undefined)).toEqual({ chains: [], methods: [], events: [] });
    expect(flattenNamespaces({})).toEqual({ chains: [], methods: [], events: [] });
    expect(flattenNamespaces({ eip155: {} })).toEqual({ chains: [], methods: [], events: [] });
  });
});

describe("toProposal", () => {
  const base = {
    id: 42,
    params: {
      pairingTopic: "pair-topic",
      proposer: { metadata: { name: "Uniswap", description: "Swap", url: "https://app.uniswap.org", icons: ["i"] } },
      requiredNamespaces: { eip155: { chains: ["eip155:1"], methods: ["personal_sign"], events: ["chainChanged"] } },
      optionalNamespaces: { eip155: { chains: ["eip155:8453"], methods: ["eth_sendTransaction"], events: [] } },
      expiryTimestamp: 1_800_000_000,
    },
    verifyContext: { verified: { origin: "https://app.uniswap.org", validation: "VALID", isScam: false } },
  } as unknown as WalletKitTypes.SessionProposal;

  it("separates required from optional", () => {
    const p = toProposal(base);
    expect(p.id).toBe(42);
    expect(p.requiredChains).toEqual(["eip155:1"]);
    expect(p.optionalChains).toEqual(["eip155:8453"]);
    expect(p.requiredMethods).toEqual(["personal_sign"]);
    expect(p.optionalMethods).toEqual(["eth_sendTransaction"]);
  });

  // Seconds on the wire, milliseconds in JS. Getting this wrong either expires
  // everything instantly or never expires anything.
  it("converts the expiry from seconds to milliseconds", () => {
    expect(toProposal(base).expiresAt).toBe(1_800_000_000 * 1000);
  });

  it("falls back to a future deadline when the expiry is missing or junk", () => {
    for (const expiryTimestamp of [undefined, 0, -1, NaN]) {
      const p = toProposal({
        ...base,
        params: { ...base.params, expiryTimestamp },
      } as unknown as WalletKitTypes.SessionProposal);
      // Must be in the FUTURE: a fallback of 0 would make every proposal
      // arrive already expired and nothing would ever be approvable.
      expect(p.expiresAt).toBeGreaterThan(Date.now());
    }
  });

  it("carries the relay's verification through", () => {
    const p = toProposal(base);
    expect(p.dapp.verified).toEqual({
      origin: "https://app.uniswap.org",
      validation: "VALID",
      isScam: false,
    });
  });

  it("survives a proposal with no namespaces at all", () => {
    const p = toProposal({
      ...base,
      params: { ...base.params, requiredNamespaces: undefined, optionalNamespaces: undefined },
    } as unknown as WalletKitTypes.SessionProposal);
    expect(p.requiredChains).toEqual([]);
    expect(p.requiredMethods).toEqual([]);
  });
});

describe("toRequest", () => {
  const base = {
    id: 7,
    topic: "session-topic",
    params: {
      chainId: "eip155:1",
      request: { method: "personal_sign", params: ["0xdead", ADDR], expiryTimestamp: 1_800_000_000 },
    },
  } as unknown as WalletKitTypes.SessionRequest;

  it("maps the request through unchanged", () => {
    const r = toRequest(base);
    expect(r).toMatchObject({
      id: 7,
      topic: "session-topic",
      chainId: "eip155:1",
      method: "personal_sign",
      params: ["0xdead", ADDR],
    });
    expect(r.expiresAt).toBe(1_800_000_000 * 1000);
  });

  // An absent expiry must not read as "already expired" — that would reject
  // every request from a dApp SDK that omits the field.
  it("gives a request with no expiry a future deadline", () => {
    const r = toRequest({
      ...base,
      params: { ...base.params, request: { method: "personal_sign", params: [] } },
    } as unknown as WalletKitTypes.SessionRequest);
    expect(r.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("toSession", () => {
  it("derives chains from accounts as well as from `chains`", () => {
    const s = toSession({
      topic: "t",
      pairingTopic: "p",
      peer: { metadata: { name: "dApp", url: "https://d.example", icons: [] } },
      namespaces: {
        eip155: {
          accounts: [`eip155:1:${ADDR}`, `eip155:8453:${ADDR}`],
          methods: ["personal_sign"],
          events: ["chainChanged"],
        },
      },
      expiry: 1_800_000_000,
    });

    expect(s.accounts).toHaveLength(2);
    // Chains recovered from the CAIP-10 accounts, so a session still lists its
    // networks when the relay returns accounts but no `chains`.
    expect(new Set(s.chains)).toEqual(new Set(["eip155:1", "eip155:8453"]));
    expect(s.methods).toEqual(["personal_sign"]);
    expect(s.expiresAt).toBe(1_800_000_000 * 1000);
  });

  it("falls back to a future expiry when the relay states none", () => {
    const s = toSession({ topic: "t", namespaces: {} });
    expect(s.expiresAt).toBeGreaterThan(Date.now());
  });

  it("survives a session with no namespaces", () => {
    const s = toSession({ topic: "t" });
    expect(s.accounts).toEqual([]);
    expect(s.chains).toEqual([]);
  });
});

describe("toDappMetadata", () => {
  it("keeps the claimed metadata as plain strings", () => {
    const m = toDappMetadata({ name: "X", description: "d", url: "https://x.example", icons: ["a", 1] }, undefined);
    expect(m).toMatchObject({ name: "X", url: "https://x.example" });
    // A non-string in the icons array is dropped rather than rendered.
    expect(m.icons).toEqual(["a"]);
  });

  it("coerces hostile metadata types to empty strings instead of throwing", () => {
    const m = toDappMetadata({ name: 42, url: null, icons: "not-an-array" }, undefined);
    expect(m.name).toBe("");
    expect(m.url).toBe("");
    expect(m.icons).toEqual([]);
  });

  it("marks a scam verdict", () => {
    const m = toDappMetadata({ name: "Fake" }, { verified: { origin: "https://evil.example", validation: "INVALID", isScam: true } });
    expect(m.verified).toEqual({ origin: "https://evil.example", validation: "INVALID", isScam: true });
  });

  it("normalises an unrecognised validation to UNKNOWN rather than trusting it", () => {
    const m = toDappMetadata({ name: "X" }, { verified: { origin: "https://x.example", validation: "SOMETHING_NEW" } });
    expect(m.verified?.validation).toBe("UNKNOWN");
  });

  it("omits `verified` entirely when the relay gave no origin", () => {
    // Absent must stay absent: an empty-but-present verified block would render
    // as though the relay had confirmed something.
    expect(toDappMetadata({ name: "X" }, { verified: {} }).verified).toBeUndefined();
    expect(toDappMetadata({ name: "X" }, undefined).verified).toBeUndefined();
  });
});
