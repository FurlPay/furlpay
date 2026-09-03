import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { setPin, verifyPin, lifecycleView, getLifecycle } from "@/lib/services/cardLifecycle";
import { PinSchema } from "@/lib/cardSchemas";
import { recordSecurityEvent } from "@/lib/ops/events";

export const dynamic = "force-dynamic";

const SetPin = z.object({ pin: PinSchema });
const VerifyPin = z.object({ pin: PinSchema });

// PUT /api/cards/lifecycle/:id/pin — set or change the card PIN.
//
// There is deliberately NO GET counterpart. An issuer that can show you your
// PIN can show it to whoever takes over your session; the PIN is stored salted
// and scrypt-hashed and is never recoverable, only replaceable.
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.pin.set", { limit: 5, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, SetPin);
  if (body instanceof NextResponse) return body;

  const { id } = await props.params;
  try {
    const lc = setPin(id, account.user.id, body.pin);
    await recordSecurityEvent({
      kind: "card_pin_set",
      rail: "transfers",
      severity: "low",
      detail: `PIN set on card ${id}`,
      actor: account.user.id,
    }).catch(() => {});
    return NextResponse.json({ ok: true, lifecycle: lifecycleView(lc) });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 400 });
  }
}

// POST /api/cards/lifecycle/:id/pin — verify a PIN (ATM-style check).
//
// Always 200 with an `ok` flag rather than 401 on a wrong PIN: the status code
// is the cheapest oracle to script against, and the body carries what the
// customer actually needs — how many tries are left, and when the lock lifts.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.pin.verify", { limit: 10, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, VerifyPin);
  if (body instanceof NextResponse) return body;

  const { id } = await props.params;
  try {
    const result = verifyPin(id, account.user.id, body.pin);
    if (!result.ok && result.lockedUntil) {
      await recordSecurityEvent({
        kind: "card_pin_locked",
        rail: "transfers",
        severity: "medium",
        detail: `PIN locked on card ${id} after repeated failures`,
        actor: account.user.id,
      }).catch(() => {});
    }
    return NextResponse.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}

// GET /api/cards/lifecycle/:id/pin — PIN STATUS ONLY: whether one is set and
// whether it is locked. Never the PIN itself.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.pin.status", { limit: 60, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const { id } = await props.params;
  try {
    const view = lifecycleView(getLifecycle(id, account.user.id));
    return NextResponse.json({ hasPin: view.hasPin, lockedUntil: view.pinLockedUntil });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
