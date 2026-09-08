import { WalletConnectEngine, hostOf } from "../engine";
import { MemoryTransport } from "../transport";
import type { SessionProposal, SessionRequest, WalletConnectSession } from "../types";

// ---------------------------------------------------------------------------
// The engine, driven end to end against MemoryTransport.
//
// expo-sqlite has no in-process driver under jest-expo (see
// lib/money/__tests__/durability.test.ts), so the session store is replaced
// with an in-memory map. Everything else is the real thing: the real policy,
// the real decoder, the real ordering.
//
// WHAT THESE TESTS ARE ACTUALLY DEFENDING is the invariant in the engine
// header — nothing is signed that the user did not see — and the four gates
// that enforce it. Each gate gets a test that fails if the gate is removed.
// ---------------------------------------------------------------------------

// `mock` prefix: jest.mock factories are hoisted above const
// declarations, and only names matching /^mock/i may be referenced from one.
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

// The scanner reaches the network; here we only care that the engine calls it
// and carries its verdict through, so it is stubbed to a fixed local result.
jest.mock("@/lib/txscan", () => ({
  scanTransaction: jest.fn(async () => ({
    level: "caution",
    category: "contract_call",
    findings: [{ id: "x", level: "caution", title: "t", detail: "d" }],
    deltas: [],
    simulated: false,
    sources: ["local"],
  })),
}));

const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

function proposal(over: Partial<SessionProposal> = {}): SessionProposal {
  return {
    id: 7,
    pairingTopic: "pair",
    dapp: { name: "Test dApp", description: "", url: "https://dapp.example/app", icons: [] },
    requiredChains: ["eip155:1"],
    optionalChains: [],
    requiredMethods: ["eth_sendTransaction", "personal_sign"],
    optionalMethods: [],
    events: ["chainChanged"],
    expiresAt: Date.now() + 60_000,
    receivedAt: Date.now(),
    ...over,
  };
}

function request(over: Partial<SessionRequest> = {}): SessionRequest {
  return {
    id: 100,
    topic: "topic-7",
    chainId: "eip155:1",
    method: "eth_sendTransaction",
    params: [{ from: ADDRESS, to: OTHER, value: "0x1", data: "0x" }],
    receivedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    ...over,
  };
}

function setup(over: { signAndSend?: jest.Mock; restored?: WalletConnectSession[] } = {}) {
  const transport = new MemoryTransport(over.restored ?? []);
  const signAndSend = over.signAndSend ?? jest.fn(async () => "0xsigned");
  const engine = new WalletConnectEngine({
    transport,
    getAddress: async () => ADDRESS,
    signAndSend,
    knownAddresses: () => ({}),
  });
  return { transport, engine, signAndSend };
}

beforeEach(() => {
  mockSessions.clear();
  jest.clearAllMocks();
});

describe("session approval", () => {
  it("grants the negotiated intersection and stores the session", async () => {
    const { transport, engine } = setup();
    await engine.start();

    transport.events!.onProposal(proposal({ optionalChains: ["eip155:8453", "eip155:99999"] }));
    await Promise.resolve();

    const pending = engine.getPendingProposal();
    expect(pending?.decision.approvable).toBe(true);
    // The unsupported optional chain is dropped, not granted.
    expect(pending?.decision.chains).toEqual(["eip155:1", "eip155:8453"]);

    const session = await engine.approveProposal(7);
    expect(session.chains).toEqual(["eip155:1", "eip155:8453"]);
    expect(engine.listSessions()).toHaveLength(1);
    expect(engine.getPendingProposal()).toBeNull();
  });

  it("refuses to approve a proposal whose required chain is unsupported", async () => {
    const { transport, engine } = setup();
    await engine.start();

    transport.events!.onProposal(proposal({ requiredChains: ["eip155:1", "eip155:56"] }));
    await Promise.resolve();

    await expect(engine.approveProposal(7)).rejects.toThrow(/cannot provide/i);
    expect(engine.listSessions()).toHaveLength(0);
  });

  it("refuses to approve an expired proposal", async () => {
    const { transport, engine } = setup();
    await engine.start();

    transport.events!.onProposal(proposal({ expiresAt: Date.now() - 1 }));
    await Promise.resolve();

    await expect(engine.approveProposal(7)).rejects.toThrow(/expired/i);
  });

  it("tells the dApp why when the user rejects", async () => {
    const { transport, engine } = setup();
    await engine.start();
    transport.events!.onProposal(proposal());
    await Promise.resolve();

    await engine.rejectProposal(7);
    expect(transport.rejectedProposals[0].error.code).toBe(4001);
    expect(engine.getPendingProposal()).toBeNull();
  });

  it("restores sessions the SDK already held, without a network round trip", async () => {
    const restored: WalletConnectSession = {
      topic: "restored",
      pairingTopic: "p",
      dapp: { name: "Old", description: "", url: "https://old.example", icons: [] },
      accounts: [`eip155:1:${ADDRESS}`],
      chains: ["eip155:1"],
      methods: ["personal_sign"],
      events: [],
      expiresAt: Date.now() + 86_400_000,
      connectedAt: Date.now() - 1000,
      lastActivityAt: Date.now() - 1000,
    };
    const { engine } = setup({ restored: [restored] });
    await engine.start();
    expect(engine.listSessions().map((s) => s.topic)).toEqual(["restored"]);
  });
});

describe("request gating", () => {
  async function connected() {
    const ctx = setup();
    await ctx.engine.start();
    ctx.transport.events!.onProposal(proposal());
    await Promise.resolve();
    await ctx.engine.approveProposal(7);
    return ctx;
  }

  it("presents a valid request to the user with its scan attached", async () => {
    const { transport, engine } = await connected();
    transport.events!.onRequest(request());
    await flush();

    const pending = engine.getPendingRequest();
    expect(pending?.intent.kind).toBe("transaction");
    expect(pending?.scan.level).toBe("caution");
    // Gate 4: nothing was signed by merely arriving.
    expect(transport.responses).toHaveLength(0);
  });

  // Gate 1.
  it("refuses a method outside the grant without prompting", async () => {
    const { transport, engine } = await connected();
    transport.events!.onRequest(request({ method: "eth_signTypedData_v4" }));
    await flush();

    expect(engine.getPendingRequest()).toBeNull();
    expect(transport.rejections[0].error.code).toBe(3001);
  });

  it("refuses a chain outside the grant", async () => {
    const { transport, engine } = await connected();
    transport.events!.onRequest(request({ chainId: "eip155:8453" }));
    await flush();
    expect(engine.getPendingRequest()).toBeNull();
    expect(transport.rejections[0].error.code).toBe(5100);
  });

  it("refuses a request on an unknown topic rather than ignoring it", async () => {
    const { transport, engine } = await connected();
    transport.events!.onRequest(request({ topic: "not-a-session" }));
    await flush();
    // Silence would leave the dApp spinning forever.
    expect(transport.rejections[0].error.code).toBe(6000);
    expect(engine.getPendingRequest()).toBeNull();
  });

  it("refuses an expired request", async () => {
    const { transport, engine } = await connected();
    transport.events!.onRequest(request({ expiresAt: Date.now() - 1 }));
    await flush();
    expect(engine.getPendingRequest()).toBeNull();
    expect(transport.rejections).toHaveLength(1);
  });

  // Gate 2: a decode failure is a rejection, never a raw-hex prompt.
  it("refuses a request it cannot decode", async () => {
    const { transport, engine } = await connected();
    transport.events!.onRequest(request({ params: [{ from: ADDRESS, to: "0xnope", data: "0x" }] }));
    await flush();
    expect(engine.getPendingRequest()).toBeNull();
    expect(transport.rejections[0].error.code).toBe(-32602);
  });

  // Two sheets racing on one screen is how a user approves the second while
  // looking at the first.
  it("refuses a second request while one is pending", async () => {
    const { transport, engine } = await connected();
    transport.events!.onRequest(request({ id: 100 }));
    await flush();
    transport.events!.onRequest(request({ id: 101 }));
    await flush();

    expect(engine.getPendingRequest()?.request.id).toBe(100);
    expect(transport.rejections.some((r) => r.id === 101)).toBe(true);
  });
});

describe("request resolution", () => {
  async function withPending(signAndSend?: jest.Mock) {
    const ctx = setup({ signAndSend });
    await ctx.engine.start();
    ctx.transport.events!.onProposal(proposal());
    await Promise.resolve();
    await ctx.engine.approveProposal(7);
    ctx.transport.events!.onRequest(request());
    await flush();
    return ctx;
  }

  it("signs and responds on approval", async () => {
    const { transport, engine, signAndSend } = await withPending();
    await engine.approveRequest(100);

    expect(signAndSend).toHaveBeenCalledTimes(1);
    expect(transport.responses[0]).toMatchObject({ topic: "topic-7", id: 100, result: "0xsigned" });
    expect(engine.getPendingRequest()).toBeNull();
  });

  it("passes the scan verdict to the signer, so it can refuse on risk", async () => {
    // Typed with its parameters so `mock.calls[0][1]` is the context argument
    // rather than an index into an empty tuple.
    const signAndSend = jest.fn(async (_intent: unknown, _context: unknown) => "0xok");
    const { engine } = await withPending(signAndSend as unknown as jest.Mock);
    await engine.approveRequest(100);
    // `origin` is derived from the STORED session's dapp url (what the
    // transport returned at approval), not from the proposal — the stored
    // session is the record the relay agreed to, and it is what a later
    // request must be attributed to.
    expect(signAndSend.mock.calls[0][1]).toMatchObject({ origin: "example.com", scan: { level: "caution" } });
  });

  it("responds 4001 on rejection", async () => {
    const { transport, engine } = await withPending();
    await engine.rejectRequest(100);
    expect(transport.rejections[0].error.code).toBe(4001);
    expect(engine.getPendingRequest()).toBeNull();
  });

  // A signing failure that returns nothing leaves the dApp waiting on a promise
  // that will never settle, and the site looks frozen because of a phone error.
  it("tells the dApp when signing fails", async () => {
    const signAndSend = jest.fn(async () => {
      throw new Error("device locked");
    });
    const { transport, engine } = await withPending(signAndSend);

    await expect(engine.approveRequest(100)).rejects.toThrow("device locked");
    expect(transport.rejections[0].error.code).toBe(-32603);
    expect(transport.rejections[0].error.message).toContain("device locked");
  });

  // The slot is freed before signing so an abandoned signature does not wedge
  // every later request behind "already showing another request".
  it("frees the pending slot before signing, not after", async () => {
    let pendingDuringSign: unknown = "unset";
    const ctx = setup({
      signAndSend: jest.fn(async () => {
        pendingDuringSign = ctx.engine.getPendingRequest();
        return "0xok";
      }),
    });
    await ctx.engine.start();
    ctx.transport.events!.onProposal(proposal());
    await Promise.resolve();
    await ctx.engine.approveProposal(7);
    ctx.transport.events!.onRequest(request());
    await flush();

    await ctx.engine.approveRequest(100);
    expect(pendingDuringSign).toBeNull();
  });

  it("ignores approval of a request that is no longer active", async () => {
    const { engine } = setup();
    await engine.start();
    await expect(engine.approveRequest(999)).rejects.toThrow(/no longer active/i);
  });
});

describe("disconnection", () => {
  it("tears down at the relay before forgetting locally", async () => {
    const { transport, engine } = setup();
    await engine.start();
    transport.events!.onProposal(proposal());
    await Promise.resolve();
    await engine.approveProposal(7);

    await engine.disconnect("topic-7");
    expect(transport.disconnected).toEqual(["topic-7"]);
    expect(engine.listSessions()).toHaveLength(0);
  });

  it("clears every session on sign-out even when the relay errors", async () => {
    const { transport, engine } = setup();
    await engine.start();
    transport.events!.onProposal(proposal());
    await Promise.resolve();
    await engine.approveProposal(7);

    transport.disconnect = jest.fn(async () => {
      throw new Error("relay down");
    });

    await engine.disconnectAllForSignOut();
    // A relay error must not leave the next user of the device holding someone
    // else's live grants.
    expect(engine.listSessions()).toHaveLength(0);
  });

  it("drops the local row when the dApp ends the session", async () => {
    const { transport, engine } = setup();
    await engine.start();
    transport.events!.onProposal(proposal());
    await Promise.resolve();
    await engine.approveProposal(7);

    transport.events!.onSessionDeleted("topic-7", "dapp");
    expect(engine.listSessions()).toHaveLength(0);
  });
});

describe("EIP-1193 events", () => {
  it("sends accountsChanged as an array, as the spec requires", async () => {
    const { transport, engine } = setup();
    await engine.start();
    await engine.announceAccount("topic-7", ADDRESS, 1);
    expect(transport.emitted[0].event).toEqual({ name: "accountsChanged", data: [ADDRESS] });
  });
});

describe("hostOf", () => {
  it("extracts a host without depending on URL", () => {
    expect(hostOf("https://app.uniswap.org/swap?x=1")).toBe("app.uniswap.org");
    expect(hostOf("http://Localhost:3000/x")).toBe("localhost:3000");
    // Never throws on junk — it renders on a confirmation screen.
    expect(hostOf("not a url")).toBe("not a url");
  });
});

/** Let the engine's async request pipeline (decode + scan) settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}
