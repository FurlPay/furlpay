import { indexNowKey } from "@/lib/seo/indexnow";

// GET /indexnow.txt — the IndexNow key file (https://www.indexnow.org/documentation).
// Contains only the key, UTF-8. It is public by design: search engines fetch
// it to confirm a submission came from the site's owner. Unconfigured or
// malformed key → 404, so nothing claims ownership with an invalid key.
// The middleware matcher skips *.txt, so this is reachable without a session.
export const dynamic = "force-dynamic";

export function GET(): Response {
  const key = indexNowKey();
  if (!key) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(key, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
