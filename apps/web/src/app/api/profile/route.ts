import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { persistAccount } from "@/lib/store";
import { validateBody } from "@/lib/validate";

// GET /api/profile - full profile + security + notification state for the
// authenticated account. Never use the seeded demo account for this route.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const u = auth.account.user;
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

// PATCH /api/profile - update only low-risk user-facing security toggles and
// notification preferences. MFA state, TOTP secrets, role, KYC, and
// subscription tier changes go through dedicated privileged flows.
const ProfilePatch = z
  .object({
    action: z.enum(["lock"]).optional(),
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

  const body = await validateBody(req, ProfilePatch);
  if (body instanceof NextResponse) return body;

  const u = auth.account.user;
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
    security,
    notifications: u.notifications,
    tier: u.tier,
  });
}
