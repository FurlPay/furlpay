import { redirect } from "next/navigation";

// /token2049 → /events/token2049-singapore-2026
//
// A vanity short URL for sharing on cards, slides and social bios. It is a
// server-side redirect (308 Permanent) so the canonical URL stays on /events/…
// and search engines consolidate signals there. No page content is rendered.
//
// Using `redirect()` from next/navigation rather than a next.config.js rewrite
// so the route is explicit in the app tree and shows up in `find` / grep when
// someone asks "what links to TOKEN2049?". A config rewrite is invisible there.

export default function Token2049Redirect(): never {
  redirect("/events/token2049-singapore-2026");
}
