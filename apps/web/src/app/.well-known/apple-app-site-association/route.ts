import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /.well-known/apple-app-site-association — iOS universal links + passkeys.
//
// WHY THIS EXISTS. The iOS app declares `applinks:furlpay.com` and
// `webcredentials:furlpay.com` (native-app/app.json), but nothing served this
// file — public/.well-known held only Android's assetlinks.json. Without it iOS
// silently ignores both: /l/ links open Safari instead of the app, and passkey
// sign-in in the app has no domain association to authorise it.
//
// THE TEAM ID IS NOT GUESSED. An app identifier is `<TEAMID>.<bundle id>`, and
// the Team ID only exists once an Apple Developer account does. Until
// APPLE_TEAM_ID is set this returns 404 — the honest answer, and the one iOS
// treats as "no association" — rather than a file naming a team that does not
// own the app. Publishing a wrong app ID would hand the association to
// whichever team does own it.
//
// PATHS MIRROR ANDROID. assetlinks.json + the Android intent filter claim only
// /l/*; the same prefix is claimed here so a link behaves the same on both.

const BUNDLE_ID = "com.furlpay.app";
const TEAM_ID = /^[A-Z0-9]{10}$/;

export function GET() {
  const teamId = (process.env.APPLE_TEAM_ID ?? "").trim();
  if (!TEAM_ID.test(teamId)) {
    return new NextResponse(null, { status: 404 });
  }

  const appId = `${teamId}.${BUNDLE_ID}`;
  return NextResponse.json(
    {
      applinks: {
        details: [{ appIDs: [appId], components: [{ "/": "/l/*" }] }],
      },
      webcredentials: { apps: [appId] },
    },
    {
      headers: {
        // Apple's CDN fetches this; it must be JSON, unredirected, and may be
        // cached. A short cache keeps a Team ID change from lingering.
        "cache-control": "public, max-age=3600",
      },
    }
  );
}
