import { redirect } from "next/navigation";

// The admin analytics dashboard moved to /analytics (same admin gate, real
// data sources). Kept as a redirect so existing links and bookmarks still land.
export default function LegacyOpsAnalytics() {
  redirect("/analytics");
}
