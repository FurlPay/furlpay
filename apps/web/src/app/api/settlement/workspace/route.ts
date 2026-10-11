import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import {
  archiveRecordSchema,
  createRecordSchema,
  validateDestination,
  type WorkspaceSnapshot,
} from "@/lib/settlement/model";
import {
  archiveRecord,
  listRecords,
  getRecord,
  RecordConflict,
  saveRecord,
} from "@/lib/settlement/repository";
import { deploymentEnvironment } from "@/lib/settlement/environment";
import { activity, inTransit, RANGES, treasury, type Range } from "@/lib/settlement/overview";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };



export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const { account } = auth;
  const limited = await rateLimitOr429(req, "settlement.workspace.read", { limit: 120, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid draft id" }, { status: 400, headers });
    try {
      const record = await getRecord(account.user.id, id);
      return NextResponse.json(record ? { record } : { error: "Draft not found" }, { status: record ? 200 : 404, headers });
    } catch { return NextResponse.json({ error: "Draft storage unavailable" }, { status: 503, headers }); }
  }
  const balances: WorkspaceSnapshot["balances"] = [
    ...account.tokenBalances.map((row) => ({
      asset: row.token,
      network: row.chain,
      amount: row.amount,
      usd: row.usdValue,
      custody: "ledger" as const,
    })),
    ...account.fiatBalances.map((row) => ({
      asset: row.currency,
      network: "bank",
      amount: row.amount,
      usd: row.usdValue,
      custody: "fiat" as const,
    })),
  ];
  const ledger = account.transactions.map((row) => ({
    id: row.id,
    category: row.category,
    direction: row.direction,
    amountUsd: row.amountUsd,
    status: row.status,
    timestamp: row.timestamp,
  }));
  const now = Date.now();
  const snapshot: WorkspaceSnapshot = {
    name: account.user.name,
    verification: account.user.kycStatus,
    environment: deploymentEnvironment(),
    balances,
    overview: {
      treasury: treasury(balances),
      inTransit: inTransit(ledger),
      activity: Object.fromEntries(RANGES.map((r) => [r, activity(ledger, r, now)])) as Record<Range, ReturnType<typeof activity>>,
    },
    transactions: account.transactions
      .slice()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 500)
      .map((row) => ({
        id: row.id,
        name: row.title,
        detail: row.subtitle || undefined,
        type: row.category,
        direction: row.direction,
        amountUsd: row.amountUsd,
        asset: row.token ?? "USD",
        network: row.chain ?? "account",
        status: row.status,
        timestamp: row.timestamp,
      })),
    records: [],
    storage: "available",
    asOf: new Date().toISOString(),
  };
  try {
    snapshot.records = await listRecords(account.user.id);
  } catch {
    snapshot.storage = "unavailable";
    snapshot.storageMessage =
      "Workspace drafts are unavailable. The database connection and settlement workspace migration must be configured.";
  }
  return NextResponse.json(snapshot, { headers });
}

// This endpoint stores instructions as DRAFTS only. It cannot activate an
// automation, produce an approval, publish a payable link or move a balance.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(
    req,
    "settlement.draft.create",
    { limit: 30, windowMs: 60_000 },
    auth.account.user.id
  );
  if (limited) return limited;
  const body = await validateBody(req, createRecordSchema);
  if (body instanceof NextResponse) return body;
  if (
    "address" in body.data &&
    !(await validateDestination(body.data.address, body.data.network))
  )
    return NextResponse.json(
      { error: "Invalid destination address" },
      { status: 400, headers }
    );
  try {
    const record = await saveRecord(auth.account.user.id, body.id, body.data);
    return NextResponse.json({ record }, { status: 201, headers });
  } catch (error) {
    if (error instanceof RecordConflict)
      return NextResponse.json(
        { error: error.message },
        { status: 409, headers }
      );
    return NextResponse.json(
      {
        error:
          "Draft storage unavailable. No successful save was confirmed; retry with the same request ID.",
      },
      { status: 503, headers }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(
    req,
    "settlement.draft.archive",
    { limit: 30, windowMs: 60_000 },
    auth.account.user.id
  );
  if (limited) return limited;
  const body = await validateBody(req, archiveRecordSchema);
  if (body instanceof NextResponse) return body;
  try {
    const found = await archiveRecord(auth.account.user.id, body.id);
    return NextResponse.json(
      found ? { archived: true } : { error: "Draft not found" },
      { status: found ? 200 : 404, headers }
    );
  } catch {
    return NextResponse.json(
      { error: "Draft storage unavailable" },
      { status: 503, headers }
    );
  }
}
