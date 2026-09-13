// ---------------------------------------------------------------------------
// Minimal Solana JSON-RPC client.
//
// Only the six methods this app actually needs. No SDK, for the same reason as
// spl.ts: `@solana/web3.js` is a large dependency on the money path, and a
// JSON-RPC envelope is four lines.
//
// FAILURES ARE TYPED AND LOUD. Every path either returns data or throws —
// nothing degrades into a zero balance or a silent "not found". A balance read
// that fails is `RpcError`, not `0`, because telling someone they hold nothing
// because a node timed out is a false statement about their money.
// ---------------------------------------------------------------------------

/** Reads are quick; a send may sit behind leader scheduling. */
const READ_TIMEOUT_MS = 10_000;
const SEND_TIMEOUT_MS = 30_000;

export type Commitment = "processed" | "confirmed" | "finalized";

export class RpcError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

export class TransactionError extends Error {
  readonly signature?: string;
  constructor(message: string, signature?: string) {
    super(message);
    this.name = "TransactionError";
    this.signature = signature;
  }
}

interface JsonRpcResponse<T> {
  jsonrpc: string;
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

/** One JSON-RPC 2.0 call. The only place a network request is made. */
async function rpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs = READ_TIMEOUT_MS,
): Promise<T> {
  if (!rpcUrl) throw new RpcError("No Solana RPC URL configured.");

  let res: Response;
  try {
    res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // A timeout and a dead network are both "we do not know", never "zero".
    const reason = e instanceof Error ? e.message : String(e);
    throw new RpcError(`${method} failed: ${reason}`);
  }

  if (!res.ok) throw new RpcError(`${method} failed: HTTP ${res.status}`, res.status);

  let json: JsonRpcResponse<T>;
  try {
    json = (await res.json()) as JsonRpcResponse<T>;
  } catch {
    throw new RpcError(`${method} returned a non-JSON response`);
  }

  if (json.error) throw new RpcError(`${method}: ${json.error.message}`, json.error.code);
  if (json.result === undefined) throw new RpcError(`${method} returned no result`);
  return json.result;
}

/** A recent blockhash, for transaction construction. */
export async function getLatestBlockhash(
  rpcUrl: string,
  commitment: Commitment = "confirmed",
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const r = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(
    rpcUrl,
    "getLatestBlockhash",
    [{ commitment }],
  );
  if (!r?.value?.blockhash) throw new RpcError("getLatestBlockhash returned no blockhash");
  return r.value;
}

/** Native SOL balance, in lamports. */
export async function getBalance(rpcUrl: string, address: string): Promise<number> {
  const r = await rpc<{ value: number }>(rpcUrl, "getBalance", [address, { commitment: "confirmed" }]);
  if (typeof r?.value !== "number") throw new RpcError("getBalance returned no value");
  return r.value;
}

/**
 * SPL token balance for one token account.
 *
 * A MISSING account throws rather than returning zero: "this ATA does not
 * exist" and "this ATA holds nothing" are different facts, and only the caller
 * knows which one matters.
 */
export async function getTokenAccountBalance(
  rpcUrl: string,
  ata: string,
): Promise<{ amount: string; decimals: number; uiAmount: number }> {
  const r = await rpc<{
    value: { amount: string; decimals: number; uiAmount: number | null };
  }>(rpcUrl, "getTokenAccountBalance", [ata, { commitment: "confirmed" }]);

  if (!r?.value?.amount) throw new RpcError("getTokenAccountBalance returned no amount");
  return {
    amount: r.value.amount,
    decimals: r.value.decimals,
    uiAmount: r.value.uiAmount ?? 0,
  };
}

/** Account info, or null when the account genuinely does not exist. */
export async function getAccountInfo(
  rpcUrl: string,
  address: string,
): Promise<{ lamports: number; owner: string; data: string } | null> {
  const r = await rpc<{
    value: { lamports: number; owner: string; data: [string, string] | string } | null;
  }>(rpcUrl, "getAccountInfo", [address, { commitment: "confirmed", encoding: "base64" }]);

  // `value: null` is the RPC's way of saying "no such account". That is a real
  // answer, distinct from an error, and the caller uses it to decide whether an
  // ATA needs creating.
  if (!r || r.value === null) return null;
  const data = Array.isArray(r.value.data) ? r.value.data[0] : r.value.data;
  return { lamports: r.value.lamports, owner: r.value.owner, data };
}

/** True when the address holds an initialized account. */
export async function accountExists(rpcUrl: string, address: string): Promise<boolean> {
  return (await getAccountInfo(rpcUrl, address)) !== null;
}

/** Submit a signed transaction. Returns the signature. */
export async function sendRawTransaction(
  rpcUrl: string,
  signedTx: Uint8Array,
  opts: { skipPreflight?: boolean } = {},
): Promise<string> {
  // base64 without Buffer — React Native does not ship Node's Buffer global.
  let binary = "";
  for (const byte of signedTx) binary += String.fromCharCode(byte);
  const encoded = typeof btoa === "function" ? btoa(binary) : "";
  if (!encoded) throw new TransactionError("Unable to base64-encode the transaction.");

  const signature = await rpc<string>(
    rpcUrl,
    "sendTransaction",
    [
      encoded,
      {
        encoding: "base64",
        // Preflight simulates the transaction first and is what catches an
        // insufficient balance or a missing account BEFORE fees are paid.
        // Skipping it is a deliberate choice, never a default.
        skipPreflight: opts.skipPreflight ?? false,
        preflightCommitment: "confirmed",
      },
    ],
    SEND_TIMEOUT_MS,
  );

  if (!signature) throw new TransactionError("sendTransaction returned no signature");
  return signature;
}

/**
 * Poll until the signature reaches `commitment`, or time out.
 *
 * Returns false on timeout rather than throwing: an unconfirmed transaction may
 * still land, so the caller must show "not yet confirmed", never "failed".
 * Throws only when the chain reports the transaction itself errored.
 */
export async function confirmTransaction(
  rpcUrl: string,
  signature: string,
  commitment: Commitment = "confirmed",
  timeoutMs = 60_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const wanted: Commitment[] =
    commitment === "processed"
      ? ["processed", "confirmed", "finalized"]
      : commitment === "confirmed"
        ? ["confirmed", "finalized"]
        : ["finalized"];

  while (Date.now() < deadline) {
    const r = await rpc<{
      value: ({ confirmationStatus: Commitment | null; err: unknown } | null)[];
    }>(rpcUrl, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);

    const status = r?.value?.[0];
    if (status) {
      if (status.err) {
        throw new TransactionError(
          `Transaction failed on chain: ${JSON.stringify(status.err)}`,
          signature,
        );
      }
      if (status.confirmationStatus && wanted.includes(status.confirmationStatus)) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}
