import { NextResponse } from "next/server";

// POST /api/auth/logout — clear the session cookie.
export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.set("furlpay_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
