import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { IntegrationNotConfiguredError } from "@/lib/integrations";
import { batchActionSchema, batchSchema } from "@/lib/payroll/model";
import { batchDetail, cancelBatch, createBatch, executionAvailable, listBatches, PayrollConflict, recordSignature, reissueExpired, submitBatch } from "@/lib/payroll/repository";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (e: unknown) => {
  if (e instanceof PayrollConflict) return NextResponse.json({ error: e.message }, { status: 409, headers });
  if (e instanceof IntegrationNotConfiguredError) return NextResponse.json({ error: "Payroll execution is unavailable: the FurlPayRouter contract is not configured for this deployment." }, { status: 503, headers });
  return NextResponse.json({ error: "Payroll is unavailable. Configure storage and apply migration 0042." }, { status: 503, headers });
};

// Payroll batches. POST creates a DRAFT with a fee quote (35 bps, min 1.50 USDC,
// plus 19 USDC per active contractor once per month) and screens every
// recipient; any recipient that is flagged, or that could not be screened,
// blocks the whole batch. PATCH {action:"submit"} turns a draft into one payment
// intent per line for the employer's wallet to sign; nothing moves until then.
// Fees are quotes: billing is not connected.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.batches.read", { limit: 60, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const id = req.nextUrl.searchParams.get("id");
  if (id && !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid batch ID" }, { status: 400, headers });
  try {
    if (id) {
      const detail = await batchDetail(auth.account.user.id, id);
      // executionAvailable: false until a reviewed FurlPayRouter is deployed. Signatures are kept either way.
      return NextResponse.json(detail ? { ...detail, executionAvailable: executionAvailable() } : { error: "Batch not found" }, { status: detail ? 200 : 404, headers });
    }
    return NextResponse.json({ batches: await listBatches(auth.account.user.id) }, { headers });
  } catch (e) { return fail(e); }
}
export async function POST(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.batches.create", { limit: 10, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const input = await validateBody(req, batchSchema); if (input instanceof NextResponse) return input;
  try { return NextResponse.json(await createBatch(auth.account.user.id, input), { status: 201, headers }); }
  catch (e) { return fail(e); }
}
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const input = await validateBody(req, batchActionSchema); if (input instanceof NextResponse) return input;
  // Signing is one request per line (up to 100 per batch); submit/re-issue/cancel stay tight.
  const limited = input.action === "sign"
    ? await rateLimitOr429(req, "payroll.batches.sign", { limit: 240, windowMs: 60_000 }, auth.account.user.id)
    : await rateLimitOr429(req, "payroll.batches.action", { limit: 5, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  try {
    const owner = auth.account.user.id;
    if (input.action === "cancel") return NextResponse.json({ batch: await cancelBatch(owner, input.id) }, { headers });
    if (input.action === "sign") {
      const line = await recordSignature(owner, input.id, input.lineId, input.signature as `0x${string}`);
      return NextResponse.json(line ? { line } : { error: "Batch not found" }, { status: line ? 200 : 404, headers });
    }
    const out = input.action === "reissue" ? await reissueExpired(owner, input.id, owner) : await submitBatch(owner, input.id, owner);
    return NextResponse.json(out ?? { error: "Batch not found" }, { status: out ? 200 : 404, headers });
  } catch (e) { return fail(e); }
}
