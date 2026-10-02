import { redirect } from "next/navigation";

// /token2049 → /events/token2049-singapore-2026
//
// A vanity short URL for sharing on cards, slides and social bios. It is a
// TEMPORARY redirect, deliberately: the short link is repointed at next year's
// edition, and a permanent (308) redirect is cached by browsers indefinitely,
// so last year's visitors would never see the new target. The canonical
// /events/<slug> page is the URL that accrues ranking.
//
// The authoritative rule is in next.config.js redirects(), which runs before
// this page and answers 307 (verified on a preview). This page is the fallback
// for any path that bypasses config redirects, and must agree with it.

export default function Token2049Redirect(): never {
  redirect("/events/token2049-singapore-2026");
}
