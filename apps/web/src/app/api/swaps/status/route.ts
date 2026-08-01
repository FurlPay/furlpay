import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/swaps/status?txHash=0x…&fromChain=…&toChain=…&bridge=…
//
// Proxies LI.FI's /v1/status, which is the only way to know a CROSS-CHAIN swap
// actually finished.
//
// WHY A SOURCE-CHAIN RECEIPT IS NOT AN ANSWER. On a bridged route, the receipt
// on the sending chain only says the funds left. The destination transfer is a
// separate transaction, minutes later, that our RPC on the source chain cannot
// see at all. A UI that stops at the source receipt tells the user their money
// has arrived when it is mid-flight — and if the bridge refunds instead, tells
// them the opposite of what happened.
//
// Status values (LI.FI): NOT_FOUND | INVALID | PENDING | DONE | FAILED, with a
// substatus that carries the detail — notably DONE+PARTIAL (arrived, different
// token) and DONE+REFUNDED / PENDING+REFUND_IN_PROGRESS, both of which are
// "finished" but emphatically not "succeeded".
// ---------------------------------------------------------------------------

const LIFI_API = process.env.LIFI_API_URL ?? "https://li.quest/v1";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // A bridged transfer is polled for minutes. Budget for that, but not for a
  // client that never stops.
  const limited = await rateLimitOr429(
    req,
    "swaps.status",
    { limit: 120, windowMs: 60_000 },
    auth.account.user.id
  );
  if (limited) return limited;

  const params = req.nextUrl.searchParams;
  const txHash = params.get("txHash") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "invalid_tx_hash" }, { status: 400 });
  }

  const upstream = new URLSearchParams({ txHash });
  // Optional, but LI.FI's docs recommend fromChain explicitly — it lets them
  // skip searching every chain, which is the difference between a fast answer
  // and a slow one on every poll.
  for (const key of ["fromChain", "toChain", "bridge"] as const) {
    const value = params.get(key);
    if (value && /^[\w-]{1,32}$/.test(value)) upstream.set(key, value);
  }

  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (process.env.LIFI_API_KEY) headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;

    const res = await fetch(`${LIFI_API}/status?${upstream}`, {
      headers,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: "upstream_error" }, { status: 502 });
    }

    const json = (await res.json()) as {
      status?: string;
      substatus?: string;
      substatusMessage?: string;
      sending?: { txHash?: string; txLink?: string };
      receiving?: { txHash?: string; txLink?: string; amount?: string };
      tool?: string;
      lifiExplorerLink?: string;
    };

    // Whitelisted through rather than spread: the upstream body is large and
    // carries fields the client has no use for.
    return NextResponse.json(
      {
        status: json.status ?? "NOT_FOUND",
        substatus: json.substatus ?? null,
        substatusMessage: json.substatusMessage ?? null,
        sending: json.sending?.txHash ?? null,
        receiving: json.receiving?.txHash ?? null,
        receivedAmount: json.receiving?.amount ?? null,
        tool: json.tool ?? null,
        explorerLink: json.lifiExplorerLink ?? null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "upstream_unreachable" }, { status: 504 });
  }
}
