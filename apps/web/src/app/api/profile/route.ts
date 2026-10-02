import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { persistAccount } from "@/lib/store";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { getAvatarUrl, initialsFor } from "@/lib/profileAvatar";
import { receiveAddressFor } from "@/lib/receiveAddress";

// GET /api/profile - full profile + security + notification state for the
// authenticated account. Never use the seeded demo account for this route.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const u = auth.account.user;
  const { totpSecret, ...security } = u.security;
  // The SAME identity fields /api/auth/session serves the header avatar.
  // Without them this route could only offer `name`, so the profile page drew a
  // single letter while the header three inches away showed the user's actual
  // photo — one person, two avatars, on the same screen.
  const avatarUrl = await getAvatarUrl(u.id);
  return NextResponse.json({
    id: u.id,
    name: u.name,
    email: u.email,
    // Null until the user chooses one (migration 0029; lib/username.ts).
    username: u.username ?? null,
    avatarUrl,
    initials: initialsFor(u.name),
    // DEPRECATED and deliberately renamed in the payload. store.ts derives it
    // from sha256("furlpay:safe:" + key): no key exists for it and no contract
    // is deployed at it, so it is an account REFERENCE and never a destination.
    // It kept the name `safeAddress` while two screens read it as a deposit
    // address — see lib/receiveAddress.ts.
    accountReference: u.safeAddress,
    // The only address a third party may send funds to. Null when the user has
    // not linked and verified a wallet; clients must render the empty state
    // rather than substituting anything address-shaped.
    receiveAddress: (() => {
      const r = receiveAddressFor(auth.account);
      return r.ok ? r.receive : null;
    })(),
    receiveAddressUnavailableReason: (() => {
      const r = receiveAddressFor(auth.account);
      return r.ok ? null : r.reason;
    })(),
    kycStatus: u.kycStatus,
    region: u.region,
    tier: u.tier,
    // Auth-method status for the Security screen. Derived from authoritative
    // state — booleans only, never the raw googleSub. Email is only ever
    // persisted on this account through a verified identity flow (OTP checked,
    // Google/Apple token verified), so a present email IS a verified one.
    authProvider: u.authProvider ?? null,
    emailVerified: Boolean(u.email),
    googleLinked: Boolean(u.googleSub),
    security,
    notifications: u.notifications,
  });
}

// PATCH /api/profile - update only low-risk user-facing security toggles and
// notification preferences. MFA state, TOTP secrets, role, KYC, and
// subscription tier changes go through dedicated privileged flows.
// Display name: printable characters, no control chars, trimmed 1–50. Kept
// deliberately permissive (people have varied real names) but bounded.
const DISPLAY_NAME = z
  .string()
  .trim()
  .min(1, "Name can't be empty")
  .max(50, "Name is too long")
  .regex(/^[\x20-\x7E\u00A0-\uFFFF]+$/, "Name contains invalid characters");

const ProfilePatch = z
  .object({
    action: z.enum(["lock"]).optional(),
    name: DISPLAY_NAME.optional(),
    security: z
      .object({
        biometricEnabled: z.boolean().optional(),
        loginAlerts: z.boolean().optional(),
      })
      .strict()
      .optional(),
    notifications: z
      .object({
        transactions: z.boolean().optional(),
        security: z.boolean().optional(),
        priceAlerts: z.boolean().optional(),
        product: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // A display-name change is user-content; cap it so the endpoint can't be used
  // to churn the account record. The middleware baseline still backstops.
  const limited = await rateLimitOr429(req, "profile.patch", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, ProfilePatch);
  if (body instanceof NextResponse) return body;

  const u = auth.account.user;
  if (body.name !== undefined && body.name !== u.name) {
    u.name = body.name;
    // No PII in the audit payload beyond the fact that the name changed.
    audit("profile.updated", u.id, { field: "name", length: body.name.length });
  }
  if (body.action === "lock") u.security.accountLocked = true;
  if (body.security?.biometricEnabled !== undefined) {
    u.security.biometricEnabled = body.security.biometricEnabled;
  }
  if (body.security?.loginAlerts !== undefined) {
    u.security.loginAlerts = body.security.loginAlerts;
  }
  if (body.notifications) {
    u.notifications = { ...u.notifications, ...body.notifications };
  }
  await persistAccount(u.id);

  const { totpSecret, ...security } = u.security;
  return NextResponse.json({
    success: true,
    name: u.name,
    security,
    notifications: u.notifications,
    tier: u.tier,
  });
}
