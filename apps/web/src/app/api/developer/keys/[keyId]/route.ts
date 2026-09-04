import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireUser } from "@/lib/authz";
import {
  API_SCOPES,
  getApiKey,
  redactApiKey,
  revokeApiKey,
  rotateApiKey,
  updateApiKey,
} from "@/lib/apiKeys";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// One key: read, update, rotate, revoke.
//
// Every handler resolves the key THROUGH the acting user, and a key belonging
// to someone else answers 404 rather than 403. A 403 would confirm that the
// id exists, which is all an enumeration attack needs.
// ---------------------------------------------------------------------------

const NOT_FOUND = NextResponse.json({ error: "not_found" }, { status: 404 });

/** Grace windows offered for rotation, in seconds. A bounded set rather than
 *  a free number: an unbounded grace period is a second live credential
 *  nobody remembers issuing. */
const GRACE_SECONDS = [0, 3_600, 86_400, 604_800] as const;

export async function GET(req: NextRequest, ctx: { params: Promise<{ keyId: string }> }) {
  const limited = await rateLimitOr429(req, "developer.keys.read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const { keyId } = await ctx.params;
  const record = await getApiKey(keyId);
  if (!record || record.userId !== auth.account.user.id) return NOT_FOUND;

  return NextResponse.json({ key: redactApiKey(record) });
}

const PatchBody = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  scopes: z.array(z.enum(API_SCOPES)).max(API_SCOPES.length).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  ipAllowlist: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  originAllowlist: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ keyId: string }> }) {
  const limited = await rateLimitOr429(req, "developer.keys.update", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", detail: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { keyId } = await ctx.params;
  try {
    const updated = await updateApiKey(auth.account.user.id, keyId, parsed.data);
    if (!updated) return NOT_FOUND;
    return NextResponse.json({ key: redactApiKey(updated) });
  } catch (e) {
    return NextResponse.json({ error: "invalid_request", message: (e as Error).message }, { status: 400 });
  }
}

const RotateBody = z.object({
  action: z.literal("rotate"),
  graceSeconds: z.number().int().refine((n) => (GRACE_SECONDS as readonly number[]).includes(n), {
    message: "graceSeconds must be one of 0, 3600, 86400, 604800",
  }),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ keyId: string }> }) {
  const limited = await rateLimitOr429(req, "developer.keys.rotate", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const parsed = RotateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", detail: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { keyId } = await ctx.params;
  try {
    const result = await rotateApiKey(auth.account.user.id, keyId, parsed.data.graceSeconds);
    if (!result) return NOT_FOUND;
    return NextResponse.json(
      {
        key: redactApiKey(result.record),
        secret: result.secret,
        warning: "This secret will not be shown again. Store it somewhere safe now.",
        previousKeyValidUntil: result.record.rotationGraceUntil,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json({ error: "invalid_request", message: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ keyId: string }> }) {
  const limited = await rateLimitOr429(req, "developer.keys.revoke", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const { keyId } = await ctx.params;
  const revoked = await revokeApiKey(auth.account.user.id, keyId);
  if (!revoked) return NOT_FOUND;
  return NextResponse.json({ revoked: true, keyId });
}
