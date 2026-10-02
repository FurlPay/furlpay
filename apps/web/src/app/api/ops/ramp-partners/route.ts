import { NextRequest } from "next/server";
import { z } from "zod";
import { requireOpsAdmin, opsOk, opsError } from "@/lib/ops/respond";
import { validateBody } from "@/lib/validate";
import { audit } from "@/lib/audit";
import { getPartnerConfig, publicPartnerConfig, setRampEnabled } from "@/lib/ramp/partnerConfig";

export const dynamic = "force-dynamic";

// /api/ops/ramp-partners — ops switch for a merchant's partner-key ramp access.
// Off by default: a merchant cannot grant itself the ability to open provider
// checkouts under FurlPay's provider account. A typed reason is required
// either way, and the change is audited.

const ToggleSchema = z.object({
  partnerId: z.string().min(1).max(128),
  enabled: z.boolean(),
  reason: z.string().trim().min(8).max(500),
});

export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  const partnerId = req.nextUrl.searchParams.get("partnerId");
  if (!partnerId || partnerId.length > 128) return opsError("partner_required", "Pass ?partnerId=.", 400);
  return opsOk(publicPartnerConfig(await getPartnerConfig(partnerId)));
}

export async function POST(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;

  const body = await validateBody(req, ToggleSchema);
  if (body instanceof Response) return body as never;

  const config = await setRampEnabled(body.partnerId, body.enabled, auth.account.user.id, body.reason);
  audit(body.enabled ? "ops.ramp_partner_enabled" : "ops.ramp_partner_disabled", auth.account.user.id, {
    partnerId: body.partnerId,
    reason: body.reason,
  });
  return opsOk(publicPartnerConfig(config));
}
