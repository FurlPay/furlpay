import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";

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
// body: { security?, notifications?, tier?, action?: "lock"|"unlock" }
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const u = db.user;

  if (body.action === "lock") u.security.accountLocked = true;
  if (body.action === "unlock") u.security.accountLocked = false;
  if (body.security) u.security = { ...u.security, ...body.security };
  if (body.notifications) u.notifications = { ...u.notifications, ...body.notifications };
  if (body.tier && ["Standard", "Pro", "Ultra"].includes(body.tier)) u.tier = body.tier;

  return NextResponse.json({ success: true, security: u.security, notifications: u.notifications, tier: u.tier });
}
