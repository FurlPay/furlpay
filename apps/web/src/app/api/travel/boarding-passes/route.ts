import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import {
  listBoardingPasses,
  minutesToBoarding,
  routeProgress,
  type BoardingPass,
} from "@/lib/travel/boardingPass";
import { requireUser } from "@/lib/authz";

// GET /api/travel/boarding-passes — the caller's flight boarding passes.
//
// Session-scoped, like /api/travel/trips: a boarding pass carries the
// passenger's name, seat and gate, so it is never served to an anonymous
// caller and never for a userId taken from the request.
//
// The derived fields (minutesToBoarding, progress) are computed HERE rather
// than in each client. Three clients render this — web, the Expo app, and the
// SwiftUI app plus its Live Activity — and three independent countdown
// implementations is three chances to disagree with the gate.

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const now = Date.now();
  const passes = listBoardingPasses(auth.account.user.id, auth.account.user.name);

  return NextResponse.json({
    count: passes.length,
    passes: passes.map((pass) => shape(pass, now)),
  });
}

/** Strip the ownership column and add the clock-derived fields clients show. */
function shape(pass: BoardingPass, now: number) {
  const { userId: _userId, ...rest } = pass;
  return {
    ...rest,
    minutesToBoarding: minutesToBoarding(pass, now),
    progress: routeProgress(pass, now),
  };
}
