import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireUser } from "@/lib/authz";
import {
  API_KEY_ENVIRONMENTS,
  API_KEY_PREFIXES,
  API_SCOPES,
  createApiKey,
  listApiKeys,
  redactApiKey,
  securityFindings,
} from "@/lib/apiKeys";
import { listAgentKeys, redactAgentKey } from "@/lib/agentPolicy";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET  /api/developer/keys  — every credential this account holds.
// POST /api/developer/keys  — mint one. The secret is in the response ONCE.
//
// Agent keys are returned alongside but come from agentPolicy: they are
// Ed25519 signing keys, not bearer secrets, and are read-only here. The two
// live on one page because an operator thinks of them as one question ("what
// can act on my account?"), not because they are the same primitive.
// ---------------------------------------------------------------------------

const CreateBody = z.object({
  name: z.string().trim().min(1).max(64),
  prefix: z.enum(API_KEY_PREFIXES),
  environment: z.enum(API_KEY_ENVIRONMENTS),
  scopes: z.array(z.enum(API_SCOPES)).max(API_SCOPES.length).default([]),
  expiresAt: z.string().datetime().nullable().optional(),
  ipAllowlist: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  originAllowlist: z.array(z.string().trim().min(1).max(255)).max(50).default([]),
});

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "developer.keys.read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const [records, agentKeys] = await Promise.all([
    listApiKeys(auth.account.user.id),
    listAgentKeys(auth.account.user.id),
  ]);

  return NextResponse.json({
    keys: records.map(redactApiKey),
    agentKeys: agentKeys.map(redactAgentKey),
    findings: securityFindings(records),
    scopes: API_SCOPES,
  });
}

export async function POST(req: NextRequest) {
  // Minting credentials is tightly budgeted: key creation is the step an
  // attacker with a stolen session reaches for to gain a credential that
  // outlives the session.
  const limited = await rateLimitOr429(req, "developer.keys.create", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", detail: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const body = parsed.data;

  if (body.expiresAt && Date.parse(body.expiresAt) <= Date.now()) {
    return NextResponse.json(
      { error: "invalid_request", message: "expiresAt must be in the future." },
      { status: 400 }
    );
  }

  try {
    const { record, secret } = await createApiKey({
      userId: auth.account.user.id,
      name: body.name,
      prefix: body.prefix,
      environment: body.environment,
      scopes: body.scopes,
      expiresAt: body.expiresAt ?? null,
      ipAllowlist: body.ipAllowlist,
      originAllowlist: body.originAllowlist,
    });

    // The one and only time the secret crosses this boundary. It is not
    // stored, not logged, and cannot be recovered from the record.
    return NextResponse.json(
      {
        key: redactApiKey(record),
        secret,
        warning: "This secret will not be shown again. Store it somewhere safe now.",
      },
      { status: 201, headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json({ error: "invalid_request", message: (e as Error).message }, { status: 400 });
  }
}
