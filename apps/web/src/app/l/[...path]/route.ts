import { NextRequest, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/publicOrigin";

export const dynamic = "force-dynamic";

// GET /l/<path> — the web side of a verified app link.
//
// Android (native-app app.json intentFilters, pathPrefix "/l/") and iOS (the
// AASA route, component "/l/*") claim ONLY this prefix, so a shared link is
// https://furlpay.com/l/<path>. With the app installed the OS opens the app,
// which strips "/l" (native-app/lib/deepLinks.ts). Without it the browser lands
// here, and the same <path> on the website is the honest equivalent.
//
// Same-origin only: the target is rebuilt from validated path segments on our
// own origin, never taken from a header or a full URL, so this cannot become an
// open redirect. The target page applies its own auth.
const SEGMENT = /^[A-Za-z0-9._~@:!$&'()*+,;=%-]+$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const ok =
    Array.isArray(path) &&
    path.length > 0 &&
    path.every((s) => s.length > 0 && s !== "." && s !== ".." && SEGMENT.test(s) && !/%2f|%5c/i.test(s));
  const target = new URL(ok ? `/${path.join("/")}` : "/", publicOrigin(req));
  if (ok) target.search = req.nextUrl.search;
  return NextResponse.redirect(target, 307);
}
