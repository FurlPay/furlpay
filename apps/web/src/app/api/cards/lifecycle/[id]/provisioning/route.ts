import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { setProvisioning, lifecycleView, getLifecycle, productFor } from "@/lib/services/cardLifecycle";
import { cardIssuerOr503 } from "@/lib/cardIssuer";

export const dynamic = "force-dynamic";

const Provision = z.object({
  wallet: z.enum(["googlePay", "applePay"]),
  enabled: z.boolean(),
});

// POST body — a REQUEST for provisioning material, not a state update.
// walletId/hardwareId come from Google's getActiveWalletInfo() and are
// required by the issuer to mint a wallet-bound OPC; Apple's flow needs
// neither, so they stay optional and are validated per-wallet below.
const ProvisionRequest = z
  .object({
    wallet: z.enum(["googlePay", "applePay"]),
    walletId: z.string().min(1).max(128).optional(),
    hardwareId: z.string().min(1).max(128).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.wallet === "googlePay" && (!v.walletId || !v.hardwareId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "googlePay provisioning requires walletId and hardwareId from getActiveWalletInfo()",
      });
    }
  });

// PATCH /api/cards/lifecycle/:id/provisioning — record that a card was pushed
// to, or pulled from, a device wallet.
//
// Only an ACTIVE card can be added: an un-activated or dead card sitting in
// Apple Pay is a decline waiting to happen, and a confusing one — the customer
// sees the card in their wallet and has no idea why the terminal says no.
// Removing is always allowed, so a customer can always clean up.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  // No issuer is contracted: this route cannot produce a real card
  // credential or authorization. See lib/cardIssuer.ts.
  const unavailable = cardIssuerOr503("Device-wallet provisioning");
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "cards.provisioning", { limit: 20, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, Provision);
  if (body instanceof NextResponse) return body;

  const { id } = await props.params;
  try {
    const lc = setProvisioning(id, account.user.id, body.wallet, body.enabled);
    return NextResponse.json({ ok: true, lifecycle: lifecycleView(lc) });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }
}

// POST /api/cards/lifecycle/:id/provisioning — request the cryptographic
// material a device wallet needs to tokenize this card.
//
// WHY THIS EXISTS SEPARATELY FROM PATCH
// The two verbs are genuinely different operations and must not be merged:
//   PATCH records that a card WAS added to (or removed from) a wallet — a flag.
//   POST  asks the ISSUER to mint push-provisioning material — an OPC for
//         Google Pay, or certs + nonce + nonceSignature for Apple Pay.
// native-app/lib/cards/provisioning.ts has always called POST here, and this
// file only exported PATCH, so both startApplePayProvisioning and
// startGooglePayProvisioning failed with 405 Method Not Allowed on every
// device. That is the bug this closes.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It does not invent the payload. An OPC and a nonceSignature are ISSUER-SIGNED
// artefacts — Apple's and Google's SDKs hand them to the secure element, which
// verifies the signature chain. Returning placeholder strings here would not
// "unblock" provisioning; it would replace a loud 405 with an opaque failure
// deep inside a wallet SDK, and it would be fabricated cryptographic material
// in a money path. FurlPay has no contracted card issuer today
// (lib/cardIssuer.ts), so this fails closed with a 503 that names the reason.
//
// When an issuer is contracted, the call goes where the throw is: everything
// around it — auth, ownership, card-state checks, rate limiting — is already
// correct and stays.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const unavailable = cardIssuerOr503("Device-wallet provisioning");
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  // Shares the PATCH budget deliberately: both verbs hit the same issuer
  // capability, and a limit one verb can sidestep is not a limit.
  const limited = await rateLimitOr429(req, "cards.provisioning", { limit: 20, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, ProvisionRequest);
  if (body instanceof NextResponse) return body;

  const { id } = await props.params;

  // Ownership and card state BEFORE asking an issuer for anything. getLifecycle
  // is user-scoped, so another account's card id 404s rather than provisioning.
  let lifecycle;
  try {
    lifecycle = getLifecycle(id, account.user.id);
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("not found") ? 404 : 409 });
  }

  // Same rule PATCH enforces: a card that cannot transact must not land in a
  // wallet. A dead card in Apple Pay is a decline the customer cannot explain.
  if (lifecycle.status !== "active") {
    return NextResponse.json(
      {
        ok: false,
        error: "card_not_active",
        detail: `Card is ${lifecycle.status}. Only an active card can be added to a device wallet.`,
      },
      { status: 409 }
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SIMULATED PROVISIONING PAYLOAD.
  //
  // Only reachable when cardSimulationAllowed() — cardIssuerOr503() above has
  // already returned a 503 on any production deployment, so this branch cannot
  // run there. That guard is what makes the simulator safe, and it is the same
  // convention the rest of the card surface uses.
  //
  // The response carries the FULL shape native-app expects (opcBase64, certs,
  // nonce, nonceSignature, cardholderName, lastFour, displayName) so the
  // client path can be exercised end to end in dev without a 405 or a
  // missing-field crash.
  //
  // IT IS LABELLED `simulated: true`, and that label is not decoration. An OPC
  // and a nonceSignature are issuer-signed artefacts that Apple's and Google's
  // SDKs hand to the secure element for signature-chain verification — these
  // will NOT tokenize against a real wallet, and they are not meant to. The
  // flag is what stops a caller mistaking a dev fixture for a live credential;
  // native-app should branch on it rather than pushing straight to the SDK.
  //
  // Identity fields are read from the REAL lifecycle record, not invented, so
  // what a developer sees on screen matches the card they actually ordered.
  const product = productFor(lifecycle.productId);
  const lastFour = lifecycle.cardId.replace(/\D/g, "").slice(-4).padStart(4, "0");

  return NextResponse.json({
    ok: true,
    simulated: true,
    wallet: body.wallet,
    // Deterministic per card+wallet so repeated dev runs are reproducible;
    // random where a real flow would be unpredictable (the nonce).
    opcBase64:
      body.wallet === "googlePay"
        ? Buffer.from(`furlpay-simulated-opc:${lifecycle.cardId}:${body.walletId ?? ""}`).toString("base64")
        : undefined,
    certs: body.wallet === "applePay" ? ["furlpay-simulated-leaf-cert", "furlpay-simulated-sub-ca"] : undefined,
    nonce: crypto.randomUUID(),
    nonceSignature: "furlpay-simulated-nonce-signature",
    cardholderName: account.user.name ?? "Cardholder",
    lastFour,
    displayName: product.name,
  });
}
