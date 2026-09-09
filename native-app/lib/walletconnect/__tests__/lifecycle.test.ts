import { WalletConnectEngine } from "../engine";
import { MemoryTransport } from "../transport";
import { parsePairingUri } from "../uri";
import type { SessionProposal, SessionRequest, WalletConnectSession } from "../types";

// ---------------------------------------------------------------------------
// End-to-end lifecycle: pair -> propose -> approve -> request -> sign ->
// switch chain -> disconnect, plus every failure branch a real session hits.
//
// COMPLEMENTS engine.test.ts rather than repeating it. That file proves each
// gate in isolation; this one drives complete SEQUENCES, because the bugs that
// survive unit tests are ordering bugs — a slot cleared at the wrong moment, an
// event emitted before the response, a disconnect that leaves a pending request
// answerable.
// ---------------------------------------------------------------------------

const mockSessions = new Map<string, WalletConnectSession>();

jest.mock("../store", () => ({
  saveSession: (s: WalletConnectSession) => void mockSessions.set(s.topic, s),
  getSession: (t: string) => mockSessions.get(t) ?? null,
  listSessions: () => Array.from(mockSessions.values()),
  removeSession: (t: string) => void mockSessions.delete(t),
  removeAllSessions: () => mockSessions.clear(),
  touchSession: () => {},
  pruneExpired: () => [],
  reconcile: (live: WalletConnectSession[]) => {
    mockSessions.clear();
    for (const s of live) mockSessions.set(s.topic, s);
    return { dropped: [], added: live.map((s) => s.topic) };
  },
}));

let mockScanLevel = "safe";
jest.mock("@/lib/txscan", () => ({
  scanTransaction: jest.fn(async () => ({
    level: mockScanLevel,
    category: "contract_call",
    findings: [],
    deltas: [],
    simulated: false,
    sources: ["local"],
  })),
}));

const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

function proposal(over: Partial<SessionProposal> = {}): SessionProposal {
  return {
    id: 1,
    pairingTopic: "pair",
    dapp: { name: "dApp", description: "", url: "https://dapp.example", icons: [] },
    requiredChains: ["eip155:1"],
    optionalChains: ["eip155:42161"],
    requiredMethods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"],
    optionalMethods: ["wallet_switchEthereumChain"],
    events: ["chainChanged", "accountsChanged"],
    expiresAt: Date.now() + 300_000,
    receivedAt: Date.now(),
    ...over,
  };
}

function request(over: Partial<SessionRequest> = {}): SessionRequest {
  return {
    id: 100,
    topic: "topic-1",
    chainId: "eip155:1",
    method: "eth_sendTransaction",
    params: [{ from: ADDRESS, to: OTHER, value: "0x1", data: "0x" }],
    receivedAt: Date.now(),
    expiresAt: Date.now() + 300_000,
    ...over,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

/**
 * `unknown` return, not `string`. A signer legitimately returns a signature
 * hex, a transaction hash, or `null` for wallet_switchEthereumChain — inferring
 * the type from the default argument would make every switch-chain test a
 * compile error.
 */
type SignAndSend = jest.Mock<Promise<unknown>, [unknown, unknown]>;

function setup(signAndSend: SignAndSend = jest.fn(async () => "0xresult") as unknown as SignAndSend) {
  const transport = new MemoryTransport();
  const engine = new WalletConnectEngine({
    transport,
    getAddress: async () => ADDRESS,
    signAndSend,
    knownAddresses: () => ({}),
  });
  return { transport, engine, signAndSend };
}

/** Pair, propose, approve — the precondition for every request test. */
async function connect(ctx: ReturnType<typeof setup>, over: Partial<SessionProposal> = {}) {
  await ctx.engine.start();
  const uri = `wc:${"b".repeat(64)}@2?relay-protocol=irn&symKey=${"a".repeat(64)}`;
  expect(parsePairingUri(uri).ok).toBe(true);
  await ctx.engine.pair(uri, "qr");

  ctx.transport.events!.onProposal(proposal(over));
  await flush();
  return ctx.engine.approveProposal(1);
}

beforeEach(() => {
  mockSessions.clear();
  mockScanLevel = "safe";
  jest.clearAllMocks();
});

describe("the happy path, end to end", () => {
  it("pairs, connects, signs a transaction and disconnects", async () => {
    const ctx = setup();
    const session = await connect(ctx);

    // The URI actually reached the relay.
    expect(ctx.transport.paired).toHaveLength(1);
    expect(session.chains).toEqual(["eip155:1", "eip155:42161"]);

    ctx.transport.events!.onRequest(request());
    await flush();
    expect(ctx.engine.getPendingRequest()).not.toBeNull();

    await ctx.engine.approveRequest(100);
    expect(ctx.transport.responses[0]).toMatchObject({ id: 100, result: "0xresult" });
    expect(ctx.engine.getPendingRequest()).toBeNull();

    await ctx.engine.disconnect("topic-1");
    expect(ctx.transport.disconnected).toEqual(["topic-1"]);
    expect(ctx.engine.listSessions()).toHaveLength(0);
  });

  it("handles personal_sign and typed data over one session", async () => {
    const ctx = setup();
    await connect(ctx);

    ctx.transport.events!.onRequest(
      request({ id: 101, method: "personal_sign", params: ["0x68656c6c6f", ADDRESS] }),
    );
    await flush();
    expect(ctx.engine.getPendingRequest()?.intent.kind).toBe("personal_sign");
    await ctx.engine.approveRequest(101);

    ctx.transport.events!.onRequest(
      request({
        id: 102,
        method: "eth_signTypedData_v4",
        params: [
          ADDRESS,
          { domain: { chainId: 1 }, primaryType: "Mail", types: { Mail: [{ name: "x", type: "string" }] }, message: { x: "y" } },
        ],
      }),
    );
    await flush();
    expect(ctx.engine.getPendingRequest()?.intent.kind).toBe("typed_data");
    await ctx.engine.approveRequest(102);

    expect(ctx.transport.responses.map((r) => r.id)).toEqual([101, 102]);
  });
});

describe("chain switching", () => {
  // A dApp that gets `null` and no chainChanged event believes the switch
  // succeeded while its own active chain never moves — and then sends the next
  // transaction on the OLD chain. Silent on both sides.
  it("emits chainChanged after responding to a switch", async () => {
    const ctx = setup(jest.fn(async () => null) as unknown as SignAndSend);
    await connect(ctx);

    ctx.transport.events!.onRequest(
      request({ id: 103, method: "wallet_switchEthereumChain", params: [{ chainId: "0xa4b1" }] }),
    );
    await flush();
    await ctx.engine.approveRequest(103);

    expect(ctx.transport.responses[0]).toMatchObject({ id: 103, result: null });
    expect(ctx.transport.emitted[0]).toMatchObject({
      topic: "topic-1",
      chainId: "eip155:42161",
      event: { name: "chainChanged", data: 42161 },
    });
  });

  // Ordering is observable: a dApp may still be awaiting the promise that
  // resolves its own switch when the event arrives.
  it("responds before it announces", async () => {
    const ctx = setup(jest.fn(async () => null) as unknown as SignAndSend);
    await connect(ctx);
    ctx.transport.events!.onRequest(
      request({ id: 104, method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }),
    );
    await flush();
    await ctx.engine.approveRequest(104);

    expect(ctx.transport.responses).toHaveLength(1);
    expect(ctx.transport.emitted).toHaveLength(1);
  });

  it("does not emit chainChanged for an ordinary transaction", async () => {
    const ctx = setup();
    await connect(ctx);
    ctx.transport.events!.onRequest(request());
    await flush();
    await ctx.engine.approveRequest(100);
    expect(ctx.transport.emitted).toHaveLength(0);
  });

  it("still reports success when the announce fails", async () => {
    const ctx = setup(jest.fn(async () => null) as unknown as SignAndSend);
    await connect(ctx);
    ctx.transport.emitSessionEvent = jest.fn(async () => {
      throw new Error("relay dropped");
    });

    ctx.transport.events!.onRequest(
      request({ id: 105, method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }),
    );
    await flush();

    // A degraded session, not a failed request: the dApp already has its result.
    await expect(ctx.engine.approveRequest(105)).resolves.toBeUndefined();
    expect(ctx.transport.responses).toHaveLength(1);
  });
});

describe("failure branches a real session hits", () => {
  it("rejects a request for a chain the session never granted", async () => {
    const ctx = setup();
    await connect(ctx, { optionalChains: [] });

    ctx.transport.events!.onRequest(request({ chainId: "eip155:8453" }));
    await flush();
    expect(ctx.transport.rejections[0].error.code).toBe(5100);
    expect(ctx.engine.getPendingRequest()).toBeNull();
  });

  it("rejects a malformed transaction without prompting", async () => {
    const ctx = setup();
    await connect(ctx);
    ctx.transport.events!.onRequest(request({ params: [{ from: ADDRESS, to: "0xzz", data: "0x" }] }));
    await flush();
    expect(ctx.engine.getPendingRequest()).toBeNull();
    expect(ctx.transport.rejections[0].error.code).toBe(-32602);
  });

  it("rejects an expired request", async () => {
    const ctx = setup();
    await connect(ctx);
    ctx.transport.events!.onRequest(request({ expiresAt: Date.now() - 1 }));
    await flush();
    expect(ctx.engine.getPendingRequest()).toBeNull();
  });

  // A risky transaction still REACHES the user — the wallet does not refuse on
  // the user's behalf — but the verdict must survive to the sheet that decides.
  it("surfaces a dangerous verdict rather than auto-rejecting", async () => {
    mockScanLevel = "danger";
    const ctx = setup();
    await connect(ctx);
    ctx.transport.events!.onRequest(request());
    await flush();

    expect(ctx.engine.getPendingRequest()?.scan.level).toBe("danger");
    expect(ctx.transport.rejections).toHaveLength(0);
  });

  it("tells the dApp when the user rejects", async () => {
    const ctx = setup();
    await connect(ctx);
    ctx.transport.events!.onRequest(request());
    await flush();
    await ctx.engine.rejectRequest(100);
    expect(ctx.transport.rejections[0].error.code).toBe(4001);
  });

  it("tells the dApp when signing throws", async () => {
    const ctx = setup(
      jest.fn(async () => {
        throw new Error("user cancelled biometric");
      }) as unknown as SignAndSend,
    );
    await connect(ctx);
    ctx.transport.events!.onRequest(request());
    await flush();

    await expect(ctx.engine.approveRequest(100)).rejects.toThrow(/biometric/);
    // The dApp is never left awaiting a promise that will not settle.
    expect(ctx.transport.rejections[0].error.code).toBe(-32603);
  });

  it("refuses a request after the dApp ended the session", async () => {
    const ctx = setup();
    await connect(ctx);
    ctx.transport.events!.onSessionDeleted("topic-1", "dapp");

    ctx.transport.events!.onRequest(request());
    await flush();
    expect(ctx.transport.rejections[0].error.code).toBe(6000);
  });

  it("survives a proposal that cannot be approved and stays usable afterwards", async () => {
    const ctx = setup();
    await ctx.engine.start();

    ctx.transport.events!.onProposal(proposal({ id: 9, requiredChains: ["eip155:99999"] }));
    await flush();
    expect(ctx.engine.getPendingProposal()?.decision.approvable).toBe(false);
    await expect(ctx.engine.approveProposal(9)).rejects.toThrow();

    await ctx.engine.rejectProposal(9, "unsupported");
    expect(ctx.engine.getPendingProposal()).toBeNull();

    // The engine is not wedged: a good proposal still connects.
    ctx.transport.events!.onProposal(proposal());
    await flush();
    await expect(ctx.engine.approveProposal(1)).resolves.toBeTruthy();
  });
});

describe("sign-out", () => {
  it("revokes every session at the relay before forgetting them", async () => {
    const ctx = setup();
    await connect(ctx);
    await ctx.engine.disconnectAllForSignOut();

    // Relay first: clearing locally first would leave a live grant the next
    // user of the device cannot see or revoke.
    expect(ctx.transport.disconnected).toEqual(["topic-1"]);
    expect(ctx.engine.listSessions()).toHaveLength(0);
  });
});
