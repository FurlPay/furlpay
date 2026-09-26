import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireUser } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { isFollowing } from "@/lib/creator";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const g = globalThis as unknown as {
  __follows?: Record<string, string[]>;
};
const follows = g.__follows ?? (g.__follows = {});

// POST /api/ambassadors/follow — Follow a creator.
// Authenticated: caller's session defines follower identity.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "ambassadors.follow", { limit: 20, windowMs: 600_000 }, auth.account.user.id);
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const followerEmail = auth.account.user.email.toLowerCase();
  const followeeEmail = str(body.followeeEmail).toLowerCase();

  if (!followeeEmail) {
    return NextResponse.json({ ok: false, error: "followeeEmail is required." }, { status: 400 });
  }

  if (!EMAIL_RE.test(followeeEmail)) {
    return NextResponse.json({ ok: false, error: "Invalid email provided." }, { status: 400 });
  }

  if (followerEmail === followeeEmail) {
    return NextResponse.json({ ok: false, error: "You cannot follow yourself." }, { status: 400 });
  }

  const list = follows[followerEmail] || [];
  if (!list.includes(followeeEmail)) {
    list.push(followeeEmail);
    follows[followerEmail] = list;
  }

  audit("ambassadors.followed", auth.account.user.id, { followee: followeeEmail });
  return NextResponse.json({ ok: true, isFollowing: true });
}

// DELETE /api/ambassadors/follow — Unfollow a creator.
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const followerEmail = auth.account.user.email.toLowerCase();
  const followeeEmail = str(req.nextUrl.searchParams.get("followeeEmail")).toLowerCase();

  if (!followeeEmail) {
    return NextResponse.json({ ok: false, error: "followeeEmail parameter is required." }, { status: 400 });
  }

  const list = follows[followerEmail] || [];
  const idx = list.indexOf(followeeEmail);
  if (idx !== -1) {
    list.splice(idx, 1);
    follows[followerEmail] = list;
  }

  audit("ambassadors.unfollowed", auth.account.user.id, { followee: followeeEmail });
  return NextResponse.json({ ok: true, isFollowing: false });
}

