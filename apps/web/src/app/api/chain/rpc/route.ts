import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { CHAIN_REGISTRY } from "@/lib/services/chainRegistry";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/chain/rpc — a narrow JSON-RPC proxy for the non-custodial signer.
//
// WHY THIS EXISTS. The native app signs Li.Fi swap transactions with a key that
// never leaves the device, then has to actually reach a node: read a nonce,
// read fee caps, read an ERC-20 allowance, broadcast, poll for a receipt. Two
// ways to give it that, and only one is acceptable:
//
//   a) Ship RPC URLs in the app. That means a hardcoded chain table inside a
//      client we cannot update on demand, and the URLs in chainRegistry.ts are
//      env-configured precisely because the good ones carry API keys. Shipping
//      those to a phone publishes them.
//   b) Proxy here. Credentials stay server-side, the app carries no chain
//      table, and there is exactly one place to rate-limit and allowlist.
//
// WHAT THIS IS NOT. It is not a general-purpose RPC passthrough. The method
// allowlist below is the whole security model: an open proxy would let any
// signed-in user drive our RPC quota, and — on providers that expose them —
// reach admin namespaces (`debug_*`, `admin_*`, `personal_*`) with our
// credentials attached. Adding a method here is a deliberate act.
//
// Note there is no eth_accounts / eth_sign / personal_sign and there never will
// be: the node holds no keys of ours, and signing happens on the device.
// ---------------------------------------------------------------------------

/**
 * Exactly the methods the signer flow needs.
 *
 * `eth_sendRawTransaction` is on the list and is the only mutating one. It is
 * safe to proxy precisely BECAUSE it is non-custodial: the payload is already
 * signed by the user's key, so this server can relay it or drop it, but cannot
 * alter it — any edit invalidates the signature.
 */
const ALLOWED_METHODS = new Set([
  "eth_blockNumber",
  "eth_chainId",
  "eth_call", // ERC-20 allowance / balanceOf reads
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getCode", // distinguishes a contract from an EOA before sending
  "eth_getTransactionCount", // nonce
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_sendRawTransaction",
]);

const RpcSchema = z.object({
  chain: z.string().min(1).max(32),
  method: z.string().min(1).max(64),
  // JSON-RPC params are heterogeneous by nature. The 100KB body cap in
  // validateBody plus the item cap here bound it; the method allowlist is what
  // actually decides whether the call is acceptable.
  params: z.array(z.unknown()).max(8).default([]),
});

const UPSTREAM_TIMEOUT_MS = 8000;

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // Tighter than the middleware baseline: a signer polls for a receipt, and a
  // stuck client should exhaust its own budget rather than our RPC quota.
  const limited = await rateLimitOr429(
    req,
    "chain.rpc",
    { limit: 120, windowMs: 60_000 },
    auth.account.user.id
  );
  if (limited) return limited;

  const body = await validateBody(req, RpcSchema);
  if (body instanceof NextResponse) return body;

  if (!ALLOWED_METHODS.has(body.method)) {
    return NextResponse.json(
      { error: "method_not_allowed", detail: `${body.method} is not proxied.` },
      { status: 403 }
    );
  }

  const chain = CHAIN_REGISTRY.find((c) => c.id === body.chain);
  if (!chain) {
    return NextResponse.json({ error: "unsupported_chain" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(chain.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        // Our own id: echoing a client-supplied one lets a caller correlate
        // nothing useful and is one more field to validate.
        id: 1,
        method: body.method,
        params: body.params,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "upstream_error", detail: `Node returned ${upstream.status}.` },
        { status: 502 }
      );
    }

    const json = (await upstream.json()) as { result?: unknown; error?: { message?: string } };

    // A JSON-RPC error is a 200 at the HTTP layer. Passing it through as a
    // success would make a reverted broadcast look like a sent transaction.
    if (json.error) {
      return NextResponse.json(
        { error: "rpc_error", detail: json.error.message ?? "The node rejected the call." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { result: json.result ?? null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    return NextResponse.json(
      {
        error: aborted ? "upstream_timeout" : "upstream_unreachable",
        // Never surface the node URL — it may carry an API key in its path.
        detail: aborted ? "The node did not respond in time." : "Could not reach the node.",
      },
      { status: 504 }
    );
  } finally {
    clearTimeout(timer);
  }
}
