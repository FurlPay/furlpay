import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/store";
import { validateBody } from "@/lib/validate";

// GET /api/profile — full profile + security + notification state.
export async function GET() {
  const u = db.user;
  // Never expose the TOTP secret to the client.
  const { totpSecret, ...security } = u.security;
  return NextResponse.json({
    id: u.id,
    name: u.name,
    email: u.email,
    safeAddress: u.safeAddress,
    kycStatus: u.kycStatus,
    region: u.region,
    tier: u.tier,
    security,
    notifications: u.notifications,
  });
}

// PATCH /api/profile — update security toggles / notifications / tier.
//
// Strict whitelist, not a spread-merge: `security` is a privileged object
// (totpSecret/totpEnabled/devices/hardwareKeys live there), and merging raw
// client JSON into it is a mass-assignment hole — a client could plant its own
// TOTP seed and defeat step-up MFA. Only the two user-facing toggles are
// writable here; MFA enrollment goes through /api/security/mfa exclusively.
const ProfilePatch = z.object({
  action: z.enum(["lock", "unlock"]).optional(),
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
  tier: z.enum(["Standard", "Pro", "Ultra"]).optional(),
});

export async function PATCH(req: NextRequest) {
  const body = await validateBody(req, ProfilePatch);
  if (body instanceof NextResponse) return body;
  const u = db.user;

  if (body.action === "lock") u.security.accountLocked = true;
  if (body.action === "unlock") u.security.accountLocked = false;
  if (body.security?.biometricEnabled !== undefined)
    u.security.biometricEnabled = body.security.biometricEnabled;
  if (body.security?.loginAlerts !== undefined) u.security.loginAlerts = body.security.loginAlerts;
  if (body.notifications) u.notifications = { ...u.notifications, ...body.notifications };
  if (body.tier) u.tier = body.tier;

  // Mirror GET: the TOTP secret never leaves the process.
  const { totpSecret, ...security } = u.security;
  return NextResponse.json({
    success: true,
    security,
    notifications: u.notifications,
    tier: u.tier,
  });
}
