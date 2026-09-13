import {
  getLatestBlockhash,
  getBalance,
  getTokenAccountBalance,
  getAccountInfo,
  accountExists,
  confirmTransaction,
  RpcError,
  TransactionError,
} from "../rpc";

// ---------------------------------------------------------------------------
// Solana JSON-RPC client.
//
// The property under test throughout: a failure is never a number. A timeout, a
// 500, a malformed body and an RPC-level error must all surface as a thrown
// RpcError — never as a zero balance, which would tell someone their money had
// vanished because a node was busy.
// ---------------------------------------------------------------------------

const URL = "https://rpc.test.invalid";

/** Capture the outgoing request and reply with a fixed JSON-RPC body. */
function mockRpc(result: unknown, opts: { status?: number; error?: { code: number; message: string } } = {}) {
  const calls: { method: string; params: unknown[] }[] = [];
  const fn = jest.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ method: body.method, params: body.params });
    const payload = opts.error
      ? { jsonrpc: "2.0", id: 1, error: opts.error }
      : { jsonrpc: "2.0", id: 1, result };
    return new Response(JSON.stringify(payload), { status: opts.status ?? 200 });
  });
  global.fetch = fn as unknown as typeof fetch;
  return { calls, fn };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("JSON-RPC 2.0 envelope", () => {
  it("sends a well-formed request", async () => {
    const { calls, fn } = mockRpc({ value: 1_000_000 });
    await getBalance(URL, "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");

    expect(fn).toHaveBeenCalledTimes(1);
    const init = fn.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(init.body));
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(calls[0].method).toBe("getBalance");
  });

  it("refuses to call with no RPC URL configured", async () => {
    mockRpc({ value: 0 });
    await expect(getBalance("", "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk")).rejects.toThrow(
      /No Solana RPC URL/,
    );
  });
});

describe("errors are typed and never become zero", () => {
  it("throws RpcError on an RPC-level error, carrying the code", async () => {
    mockRpc(null, { error: { code: -32602, message: "Invalid param" } });
    await expect(getBalance(URL, "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk")).rejects.toThrow(
      RpcError,
    );
    try {
      await getBalance(URL, "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
    } catch (e) {
      expect((e as RpcError).code).toBe(-32602);
      expect((e as RpcError).message).toMatch(/Invalid param/);
    }
  });

  it("throws on HTTP failure rather than returning 0", async () => {
    mockRpc(null, { status: 503 });
    await expect(getBalance(URL, "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk")).rejects.toThrow(
      /HTTP 503/,
    );
  });

  it("throws on a non-JSON body", async () => {
    global.fetch = jest.fn(async () => new Response("<html>502</html>", { status: 200 })) as never;
    await expect(getBalance(URL, "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk")).rejects.toThrow(
      /non-JSON/,
    );
  });

  it("throws on a network failure / timeout", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("The operation was aborted due to timeout");
    }) as never;
    await expect(getBalance(URL, "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk")).rejects.toThrow(
      /timeout/,
    );
  });

  it("throws when the result field is absent", async () => {
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1 }), { status: 200 }),
    ) as never;
    await expect(getBalance(URL, "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk")).rejects.toThrow(
      /no result/,
    );
  });
});

describe("getLatestBlockhash", () => {
  it("returns the blockhash and height", async () => {
    mockRpc({ value: { blockhash: "9xQeWvG816bUx9EPa2", lastValidBlockHeight: 123 } });
    const r = await getLatestBlockhash(URL);
    expect(r.blockhash).toBe("9xQeWvG816bUx9EPa2");
    expect(r.lastValidBlockHeight).toBe(123);
  });

  it("throws when no blockhash comes back", async () => {
    mockRpc({ value: {} });
    await expect(getLatestBlockhash(URL)).rejects.toThrow(/no blockhash/);
  });
});

describe("getTokenAccountBalance", () => {
  it("returns the raw amount as a string, not a number", async () => {
    mockRpc({ value: { amount: "1000000000000000", decimals: 6, uiAmount: 1_000_000_000 } });
    const r = await getTokenAccountBalance(URL, "guwpTEa7UoAknrS4xeASP5iA5iqEsDfhGT2GXwDnTZS");
    // The whole FURL supply in base units exceeds what a float holds exactly.
    expect(r.amount).toBe("1000000000000000");
    expect(typeof r.amount).toBe("string");
    expect(r.decimals).toBe(6);
  });

  it("throws for a missing account rather than reporting zero", async () => {
    mockRpc(null, { error: { code: -32602, message: "could not find account" } });
    await expect(
      getTokenAccountBalance(URL, "guwpTEa7UoAknrS4xeASP5iA5iqEsDfhGT2GXwDnTZS"),
    ).rejects.toThrow(RpcError);
  });
});

describe("getAccountInfo", () => {
  it("returns null for an account that genuinely does not exist", async () => {
    // `value: null` is a real answer, distinct from an error — it is how the
    // caller decides an ATA needs creating.
    mockRpc({ value: null });
    expect(await getAccountInfo(URL, "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk")).toBeNull();
    expect(await accountExists(URL, "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk")).toBe(false);
  });

  it("returns owner and lamports for an existing account", async () => {
    mockRpc({
      value: { lamports: 2039280, owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", data: ["AQID", "base64"] },
    });
    const r = await getAccountInfo(URL, "guwpTEa7UoAknrS4xeASP5iA5iqEsDfhGT2GXwDnTZS");
    expect(r?.owner).toBe("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    expect(r?.lamports).toBe(2039280);
    expect(r?.data).toBe("AQID");
  });

  it("distinguishes 'does not exist' from 'could not check'", async () => {
    mockRpc(null, { status: 500 });
    await expect(getAccountInfo(URL, "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk")).rejects.toThrow(
      RpcError,
    );
  });
});

describe("confirmTransaction", () => {
  it("returns true once the status reaches the wanted commitment", async () => {
    mockRpc({ value: [{ confirmationStatus: "confirmed", err: null }] });
    expect(await confirmTransaction(URL, "sig123", "confirmed", 5_000)).toBe(true);
  });

  it("accepts finalized when only confirmed was required", async () => {
    mockRpc({ value: [{ confirmationStatus: "finalized", err: null }] });
    expect(await confirmTransaction(URL, "sig123", "confirmed", 5_000)).toBe(true);
  });

  it("does NOT accept processed when confirmed was required", async () => {
    mockRpc({ value: [{ confirmationStatus: "processed", err: null }] });
    expect(await confirmTransaction(URL, "sig123", "confirmed", 2_500)).toBe(false);
  });

  it("throws TransactionError when the chain reports the tx failed", async () => {
    mockRpc({ value: [{ confirmationStatus: "confirmed", err: { InstructionError: [0, "Custom"] } }] });
    await expect(confirmTransaction(URL, "sig123", "confirmed", 5_000)).rejects.toThrow(
      TransactionError,
    );
  });

  it("returns false on timeout — unconfirmed is not failed", async () => {
    // The transaction may still land, so the caller must say "not yet
    // confirmed", never "failed".
    mockRpc({ value: [null] });
    expect(await confirmTransaction(URL, "sig123", "confirmed", 2_500)).toBe(false);
  });
});
