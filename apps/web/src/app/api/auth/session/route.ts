import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { optionalUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getAvatarUrl, initialsFor } from "@/lib/profileAvatar";

// GET /api/auth/session — who, if anyone, is signed in.
//
// This exists because /api/profile answers the same question with a 401, and a
// 401 is the wrong answer for a PUBLIC page. /markets renders for anonymous
// readers; the avatar in its header has to know whether to show a sign-in
// prompt or a profile menu, and asking a route that rejects anonymous callers
// would put a red line in the console of a page that is working correctly.
//
// Three states, and the client switches on `status` rather than inferring:
//
//   anonymous   no credential was offered — show the sign-in avatar
//   expired     a credential WAS offered and was rejected — say the session
//               ended, rather than silently demoting the user to a stranger
//   active      a real session — the profile menu, with real identity
//
// Deliberately narrow. This is the most frequently called authenticated route
// in the app and it renders in a header, so it carries identity and nothing
// else: no balances, no KYC state, no security settings. /api/profile remains
// the place that answers for those, behind its 401.

export async function GET(req: NextRequest) {
  // The middleware baseline only rate-limits MUTATING methods, so a public GET
  // has no flood control of its own (AGENTS.md rule 2). The budget is generous
  // because this is a header component on a public page that re-checks on
  // navigation — but it is bounded, so the route cannot be used as a free
  // session-probing oracle.
  const limited = await rateLimitOr429(req, "auth.session", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await optionalUser(req);

  if (auth.kind === "anonymous") {
    return NextResponse.json({ status: "anonymous", user: null });
  }

  if (auth.kind === "rejected") {
    // 200, not 401. The caller asked "is anyone signed in"; "no, and your
    // session just ended" is a successful answer to that question, and a 401
    // here would trip the app-wide fetch error handling on a public page.
    return NextResponse.json({ status: "expired", user: null });
  }

  const u = auth.account.user;
  const avatarUrl = await getAvatarUrl(u.id);

  return NextResponse.json({
    status: "active",
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      // Two letters from the real name, or null when there is no name to take
      // them from. The client draws a silhouette in that case.
      initials: initialsFor(u.name),
      avatarUrl,
      tier: u.tier,
    },
  });
}
