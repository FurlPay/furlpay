// ---------------------------------------------------------------------------
// The origin clients reached us on, for anything that goes back OUT to them
// or must match what they signed: redirects, OAuth metadata, DPoP `htu`,
// HTTP-signature target URIs, checkout return URLs, CSRF origin checks.
//
// Why not req.url / req.nextUrl.origin:
//   On ECS the standalone server builds the request URL from its own bind
//   address, so every one of them is `https://0.0.0.0:3000` (verified on next
//   15.5.26), and the Host header is the ALB origin hostname because CloudFront
//   does not forward the viewer's. Neither is the public origin, and neither
//   comes from the client — X-Forwarded-Host is ignored by the URL
//   construction, and nothing here reads it.
//
// PUBLIC_API_ORIGIN (set by Terraform to https://<domain_name>) is the answer
// there. Unset — Vercel, local dev — the platform-derived origin is correct:
// Vercel routes only the project's configured domains.
//
// Edge-runtime safe (middleware imports it): no Node APIs.
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>;

export class PublicOriginConfigError extends Error {
  constructor(value: string) {
    super(`PUBLIC_API_ORIGIN must be a bare https origin (https://host[:port]); got ${JSON.stringify(value)}`);
    this.name = "PublicOriginConfigError";
  }
}

/** A configured origin, validated: https, no path, query, fragment or credentials. */
export function configuredPublicOrigin(env: Env = process.env): string | null {
  const raw = env.PUBLIC_API_ORIGIN?.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new PublicOriginConfigError(raw);
  }
  const bare = (u.pathname === "/" || u.pathname === "") && !u.search && !u.hash && !u.username && !u.password;
  if (u.protocol !== "https:" || !bare || raw.replace(/\/$/, "") !== u.origin) throw new PublicOriginConfigError(raw);
  return u.origin;
}

/** The public origin for this request. */
export function publicOrigin(req: { nextUrl: { origin: string } } | { url: string }, env: Env = process.env): string {
  const configured = configuredPublicOrigin(env);
  if (configured) return configured;
  return "nextUrl" in req ? req.nextUrl.origin : new URL(req.url).origin;
}

/** The public URL of this request: public origin + the request's path and query. */
export function publicRequestUrl(req: { url: string }, env: Env = process.env): URL {
  const u = new URL(req.url);
  return new URL(`${u.pathname}${u.search}`, publicOrigin(req, env));
}
