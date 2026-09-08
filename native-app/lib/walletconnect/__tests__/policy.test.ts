import {
  buildApprovedNamespaces,
  chainIdFromCaip,
  isRequestAuthorized,
  isSupportedMethod,
  negotiateNamespaces,
  REFUSED_METHODS,
} from "../policy";
import type { SessionProposal } from "../types";

// This file is the security boundary of WalletConnect: what is granted here is
// what a dApp may do for the life of the session. The tests are written around
// the ways a permissive implementation goes wrong, not the happy path.

function proposal(over: Partial<SessionProposal> = {}): SessionProposal {
  return {
    id: 1,
    pairingTopic: "p",
    dapp: { name: "Test", description: "", url: "https://dapp.example", icons: [] },
    requiredChains: ["eip155:1"],
    optionalChains: [],
    requiredMethods: ["personal_sign"],
    optionalMethods: [],
    events: ["chainChanged"],
    expiresAt: Date.now() + 60_000,
    receivedAt: Date.now(),
    ...over,
  };
}

describe("negotiateNamespaces", () => {
  it("approves the intersection of what is asked and what is supported", () => {
    const d = negotiateNamespaces(
      proposal({
        requiredChains: ["eip155:1"],
        optionalChains: ["eip155:42161", "eip155:999999"],
        requiredMethods: ["personal_sign"],
        optionalMethods: ["eth_sendTransaction", "eth_chainId_nonsense"],
      }),
    );

    expect(d.approvable).toBe(true);
    expect(d.chains).toEqual(["eip155:1", "eip155:42161"]);
    expect(d.methods).toEqual(["personal_sign", "eth_sendTransaction"]);
    // Unsupported optionals are dropped, not granted and not fatal.
    expect(d.droppedOptional).toContain("eip155:999999");
    expect(d.droppedOptional).toContain("eth_chainId_nonsense");
  });

  // The failure this whole file exists to prevent: echoing the request back.
  it("never grants a chain that was not supported, even if required", () => {
    const d = negotiateNamespaces(proposal({ requiredChains: ["eip155:1", "eip155:56"] }));
    expect(d.approvable).toBe(false);
    expect(d.chains).toEqual(["eip155:1"]);
    expect(d.unsupportedRequired.length).toBeGreaterThan(0);
  });

  it("refuses the session when a required method is unsupported", () => {
    const d = negotiateNamespaces(proposal({ requiredMethods: ["personal_sign", "eth_weird"] }));
    expect(d.approvable).toBe(false);
    expect(d.methods).toEqual(["personal_sign"]);
    expect(d.unsupportedRequired).toContain("eth_weird");
  });

  // eth_sign signs an arbitrary digest with no domain separation — a dApp can
  // hand over the hash of a transfer and have the user "sign a message".
  it("never grants eth_sign, required or optional", () => {
    const asRequired = negotiateNamespaces(proposal({ requiredMethods: ["eth_sign"] }));
    expect(asRequired.approvable).toBe(false);
    expect(asRequired.methods).not.toContain("eth_sign");

    const asOptional = negotiateNamespaces(
      proposal({ requiredMethods: ["personal_sign"], optionalMethods: ["eth_sign"] }),
    );
    expect(asOptional.approvable).toBe(true);
    expect(asOptional.methods).not.toContain("eth_sign");
    expect(asOptional.droppedOptional).toContain("eth_sign");
  });

  it("refuses a session with no supported chain at all", () => {
    const d = negotiateNamespaces(proposal({ requiredChains: [], optionalChains: ["eip155:999999"] }));
    expect(d.approvable).toBe(false);
  });

  it("refuses a session with no supported method at all", () => {
    const d = negotiateNamespaces(proposal({ requiredMethods: [], optionalMethods: ["nonsense"] }));
    expect(d.approvable).toBe(false);
  });

  it("does not duplicate a chain listed as both required and optional", () => {
    const d = negotiateNamespaces(proposal({ requiredChains: ["eip155:1"], optionalChains: ["eip155:1"] }));
    expect(d.chains).toEqual(["eip155:1"]);
  });

  it("keeps only events it can actually emit", () => {
    const d = negotiateNamespaces(proposal({ events: ["chainChanged", "somethingElse"] }));
    expect(d.events).toEqual(["chainChanged"]);
  });
});

describe("buildApprovedNamespaces", () => {
  it("emits one CAIP-10 account per granted chain", () => {
    const address = "0x1111111111111111111111111111111111111111";
    const d = negotiateNamespaces(proposal({ requiredChains: ["eip155:1"], optionalChains: ["eip155:8453"] }));
    const ns = buildApprovedNamespaces(d, address);

    // Omitting an account silently removes that chain from the dApp's view even
    // though we granted it — a session that half-works in a way nobody can debug.
    expect(ns.eip155.accounts).toEqual([`eip155:1:${address}`, `eip155:8453:${address}`]);
    expect(ns.eip155.chains).toEqual(["eip155:1", "eip155:8453"]);
  });
});

describe("isRequestAuthorized", () => {
  const session = { chains: ["eip155:1"], methods: ["personal_sign"] };

  it("allows what the session granted", () => {
    expect(isRequestAuthorized(session, "eip155:1", "personal_sign")).toEqual({ ok: true });
  });

  // Checked on EVERY request, not only at approval: a relay message is
  // untrusted input regardless of what was agreed earlier.
  it("refuses a method outside the grant", () => {
    expect(isRequestAuthorized(session, "eip155:1", "eth_sendTransaction")).toEqual({ ok: false, reason: "method" });
  });

  it("refuses a chain outside the grant", () => {
    expect(isRequestAuthorized(session, "eip155:8453", "personal_sign")).toEqual({ ok: false, reason: "chain" });
  });

  // A refused method stays refused even if a bug put it in the session's list.
  it("refuses eth_sign even when the session appears to grant it", () => {
    const broken = { chains: ["eip155:1"], methods: ["eth_sign"] };
    expect(isRequestAuthorized(broken, "eip155:1", "eth_sign")).toEqual({ ok: false, reason: "refused" });
  });
});

describe("chainIdFromCaip", () => {
  it("reads EVM chain ids", () => {
    expect(chainIdFromCaip("eip155:42161")).toBe(42161);
  });

  it("returns null for non-EVM namespaces and junk", () => {
    expect(chainIdFromCaip("solana:mainnet")).toBeNull();
    expect(chainIdFromCaip("eip155:abc")).toBeNull();
    expect(chainIdFromCaip("nonsense")).toBeNull();
    expect(chainIdFromCaip("eip155:0")).toBeNull();
  });
});

describe("REFUSED_METHODS", () => {
  it("explains each refusal rather than merely omitting it", () => {
    for (const [method, reason] of Object.entries(REFUSED_METHODS)) {
      expect(isSupportedMethod(method)).toBe(false);
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
