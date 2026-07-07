import { NextRequest, NextResponse } from "next/server";

// GET /api/ambassadors/instagram?handle=&email=
// Fetches an Instagram Business/Creator profile via Meta's business_discovery
// edge to prefill the creator's profile and verify their follower count.
// Mock-safe: if IG_ACCESS_TOKEN + IG_USER_ID are set, calls the real Graph API;
// otherwise returns a deterministic mock derived from the handle so the
// "Sync from Instagram" button works in development.
//
// Real call (see Meta IG User / Business Discovery docs):
//   GET https://graph.facebook.com/v25.0/{IG_USER_ID}/business_discovery
//       ?fields=business_discovery.username({handle})
//         {username,name,biography,followers_count,media_count,profile_picture_url}
//       &access_token={IG_ACCESS_TOKEN}

export const dynamic = "force-dynamic";

const GRAPH_VERSION = "v25.0";

interface IgProfile {
  username: string;
  name: string;
  biography: string;
  followersCount: number;
  mediaCount: number;
  profilePictureUrl?: string;
  verified: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const cleanHandle = (h: string) => h.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").trim();

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mockProfile(handle: string): IgProfile {
  const h = hash(handle.toLowerCase());
  const followers = 400 + (h % 90_000);
  const title = handle
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return {
    username: handle,
    name: title || handle,
    biography: `Travel creator · sharing trips & tips ✈️`,
    followersCount: followers,
    mediaCount: 50 + (h % 900),
    verified: followers > 50_000,
  };
}

async function realProfile(handle: string): Promise<IgProfile | null> {
  const token = process.env.IG_ACCESS_TOKEN;
  const userId = process.env.IG_USER_ID;
  if (!token || !userId) return null;

  const fields = `business_discovery.username(${handle}){username,name,biography,followers_count,media_count,profile_picture_url}`;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${userId}/business_discovery?fields=${encodeURIComponent(
    fields
  )}&access_token=${encodeURIComponent(token)}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    business_discovery?: {
      username: string;
      name?: string;
      biography?: string;
      followers_count?: number;
      media_count?: number;
      profile_picture_url?: string;
    };
  };
  const bd = data.business_discovery;
  if (!bd) return null;
  return {
    username: bd.username,
    name: bd.name || bd.username,
    biography: bd.biography || "",
    followersCount: bd.followers_count ?? 0,
    mediaCount: bd.media_count ?? 0,
    profilePictureUrl: bd.profile_picture_url,
    verified: (bd.followers_count ?? 0) > 50_000,
  };
}

export async function GET(req: NextRequest) {
  const handle = cleanHandle(str(req.nextUrl.searchParams.get("handle")));
  if (!handle) {
    return NextResponse.json({ ok: false, error: "A ?handle= is required." }, { status: 400 });
  }

  let profile: IgProfile | null = null;
  try {
    profile = await realProfile(handle);
  } catch {
    profile = null; // fall through to mock on any Graph API failure
  }
  const mocked = !profile;
  if (!profile) profile = mockProfile(handle);

  return NextResponse.json({ ok: true, mocked, profile });
}
