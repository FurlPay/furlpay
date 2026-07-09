import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { isFollowing } from "@/lib/creator";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const g = globalThis as unknown as {
  __follows?: Record<string, string[]>;
};
const follows = g.__follows ?? (g.__follows = {});

// POST /api/ambassadors/follow — Follow a creator.
// Body: { followerEmail: string, followeeEmail: string }
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "ambassadors.follow", { limit: 20, windowMs: 600_000 });
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const followerEmail = str(body.followerEmail).toLowerCase();
  const followeeEmail = str(body.followeeEmail).toLowerCase();

  if (!followerEmail || !followeeEmail) {
    return NextResponse.json({ ok: false, error: "Both followerEmail and followeeEmail are required." }, { status: 400 });
  }

  if (!EMAIL_RE.test(followerEmail) || !EMAIL_RE.test(followeeEmail)) {
    return NextResponse.json({ ok: false, error: "Invalid emails provided." }, { status: 400 });
  }

  if (followerEmail === followeeEmail) {
    return NextResponse.json({ ok: false, error: "You cannot follow yourself." }, { status: 400 });
  }

  const list = follows[followerEmail] || [];
  if (!list.includes(followeeEmail)) {
    list.push(followeeEmail);
    follows[followerEmail] = list;
  }

  console.log(`[ambassadors] follow: <${followerEmail}> followed <${followeeEmail}>`);
  return NextResponse.json({ ok: true, isFollowing: true });
}

// DELETE /api/ambassadors/follow — Unfollow a creator.
// Query: ?followerEmail=...&followeeEmail=...
export async function DELETE(req: NextRequest) {
  const followerEmail = str(req.nextUrl.searchParams.get("followerEmail")).toLowerCase();
  const followeeEmail = str(req.nextUrl.searchParams.get("followeeEmail")).toLowerCase();

  if (!followerEmail || !followeeEmail) {
    return NextResponse.json({ ok: false, error: "Both followerEmail and followeeEmail parameters are required." }, { status: 400 });
  }

  const list = follows[followerEmail] || [];
  const idx = list.indexOf(followeeEmail);
  if (idx !== -1) {
    list.splice(idx, 1);
    follows[followerEmail] = list;
  }

  console.log(`[ambassadors] unfollow: <${followerEmail}> unfollowed <${followeeEmail}>`);
  return NextResponse.json({ ok: true, isFollowing: false });
}
