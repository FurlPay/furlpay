import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { checkUrl } from "@/lib/property/safeFetch";
import { audit } from "@/lib/audit";
import {
  PartnerWebhookKeyUnavailable,
  clearPartnerWebhook,
  getPartnerConfig,
  publicPartnerConfig,
  setPartnerWebhook,
} from "@/lib/ramp/partnerConfig";

export const dynamic = "force-dynamic";

// /api/developer/ramp — a merchant's own ramp settings.
//
// GET    whether ramps are enabled (ops decides, /api/ops/ramp-partners) and
//        the configured callback.
// PUT    set the callback URL. Returns a NEW signing secret, once.
// DELETE remove the callback.
//
// The URL is validated now (https, resolves to a public address) and again at
// every delivery, because DNS can change in between (lib/ramp/partnerWebhooks.ts).

const WebhookSchema = z.object({
  webhookUrl: z.string().url().startsWith("https://").max(500),
});

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "developer.ramp.read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  return NextResponse.json(publicPartnerConfig(await getPartnerConfig(auth.account.user.id)));
}

export async function PUT(req: NextRequest) {
  const limited = await rateLimitOr429(req, "developer.ramp.write", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const body = await validateBody(req, WebhookSchema);
  if (body instanceof NextResponse) return body;

  const check = await checkUrl(body.webhookUrl);
  if (!check.ok) {
    return NextResponse.json({ error: "webhook_url_refused", reason: check.reason }, { status: 400 });
  }

  try {
    const { config, secret } = await setPartnerWebhook(auth.account.user.id, body.webhookUrl);
    audit("developer.ramp_webhook_set", auth.account.user.id, { host: new URL(body.webhookUrl).host });
    // The only time the secret leaves the server.
    return NextResponse.json({ ...publicPartnerConfig(config), webhookSecret: secret });
  } catch (e) {
    if (e instanceof PartnerWebhookKeyUnavailable) {
      return NextResponse.json({ error: "not_available", detail: "Partner webhooks are not configured on this deployment." }, { status: 503 });
    }
    throw e;
  }
}

export async function DELETE(req: NextRequest) {
  const limited = await rateLimitOr429(req, "developer.ramp.write", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const config = await clearPartnerWebhook(auth.account.user.id);
  audit("developer.ramp_webhook_cleared", auth.account.user.id, {});
  return NextResponse.json(publicPartnerConfig(config));
}
