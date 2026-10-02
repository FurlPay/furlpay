import { permanentRedirect } from "next/navigation";

// /token2049 → /events/token2049-singapore-2026
//
// A vanity short URL for sharing on cards, slides and social bios. It is a
// server-side PERMANENT redirect so the canonical URL stays on /events/… and
// search engines consolidate signals there. No page content is rendered.
//
// permanentRedirect(), not redirect(): in a Server Component redirect() answers
// 307 Temporary, which this header used to claim was a 308 — verified on a
// preview, /token2049 returned 307. permanentRedirect() is the 308.
//
// Using next/navigation rather than a next.config.js rewrite so the route is
// explicit in the app tree and shows up in `find` / grep when someone asks
// "what links to TOKEN2049?". A config rewrite is invisible there.

export default function Token2049Redirect(): never {
  permanentRedirect("/events/token2049-singapore-2026");
}
