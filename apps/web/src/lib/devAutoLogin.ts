// Local-development auto sign-in (see app/api/auth/dev-session/route.ts).
//
// Two independent conditions, both required:
//   - NODE_ENV !== "production": every production and preview build is
//     excluded, whatever its environment variables say;
//   - FURLPAY_DEV_AUTO_LOGIN === "1": a server-only opt-in (not NEXT_PUBLIC_),
//     set in a developer's git-ignored apps/web/.env.local.
// Edge-safe: no Node imports, so the middleware can call it.

import { safeRedirectPath } from "./safeRedirect";

type Env = Record<string, string | undefined>;

export function devAutoLoginEnabled(env: Env = process.env): boolean {
  return env.NODE_ENV !== "production" && env.FURLPAY_DEV_AUTO_LOGIN === "1";
}

/** Same-origin path only (lib/safeRedirect). Anything else → "/". The origin is
 *  only used to resolve; the caller resolves the returned path against its own. */
export function safeNextPath(raw: string | null | undefined): string {
  return safeRedirectPath(raw, "https://furlpay.invalid", "/");
}
