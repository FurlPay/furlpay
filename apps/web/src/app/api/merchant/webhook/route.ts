import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { audit } from "@/lib/audit";
import { deleteEndpoint, getEndpoint, recentDeliveries, redeliver, setEndpoint } from "@/lib/payments/merchant/webhooks";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const unavailable = () => NextResponse.json({ error: "Merchant webhooks are unavailable. Apply migrations 0040 and 0041 and set FURLPAY_PARTNER_WEBHOOK_KEY." }, { status: 503, headers });

// GET    /api/merchant/webhook  → { endpoint: { url, secretLast4, updatedAt } | null }
// PUT    /api/merchant/webhook  { url } → { url, secret, secretLast4 } (secret shown ONCE; rotates)
// POST   /api/merchant/webhook  { redeliver: <event id> } → re-queue one failed event
// DELETE /api/merchant/webhook
// The merchant is always the signed-in account; no merchant id is accepted from the client.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "merchant.webhook.read", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  try {
    const [endpoint, deliveries] = await Promise.all([getEndpoint(auth.account.user.id), recentDeliveries(auth.account.user.id)]);
    return NextResponse.json({ endpoint, deliveries }, { headers });
  } catch {
    return unavailable();
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "merchant.webhook.write", { limit: 10, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  const body = await validateBody(req, z.object({ url: z.string().trim().url().max(500).startsWith("https://") }).strict());
  if (body instanceof NextResponse) return body;
  try {
    const result = await setEndpoint(auth.account.user.id, body.url);
    if ("refused" in result) return NextResponse.json({ error: result.refused }, { status: 422, headers });
    audit("merchant.webhook.set", auth.account.user.id, { host: new URL(result.url).host, secretLast4: result.secretLast4 });
    return NextResponse.json(result, { headers });
  } catch {
    return unavailable();
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "merchant.webhook.write", { limit: 10, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  const body = await validateBody(req, z.object({ redeliver: z.string().uuid() }).strict());
  if (body instanceof NextResponse) return body;
  try {
    const ok = await redeliver(auth.account.user.id, body.redeliver);
    return ok
      ? NextResponse.json({ requeued: true }, { headers })
      : NextResponse.json({ error: "Only your own events that failed every delivery attempt can be re-sent." }, { status: 409, headers });
  } catch {
    return unavailable();
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "merchant.webhook.write", { limit: 10, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;
  try {
    await deleteEndpoint(auth.account.user.id);
    audit("merchant.webhook.deleted", auth.account.user.id, {});
    return new NextResponse(null, { status: 204, headers });
  } catch {
    return unavailable();
  }
}
