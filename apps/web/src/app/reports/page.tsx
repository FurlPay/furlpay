import { redirect } from "next/navigation";

// The research library moved to /research (desks, cadence, year and search).
// Report pages keep their /reports/<slug> URLs. 307, not 308: /reports was
// never in the production sitemap, and a temporary redirect keeps the option
// to reuse the path without a permanent browser cache entry.
export default function ReportsIndex(): never {
  redirect("/research");
}
