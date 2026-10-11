"use client";

import RwaIndex from "@/components/rwa/RwaIndex";

// /analytics/rwa — admin only: the /analytics layout's server-side gate runs
// before this renders, and /api/ops/rwa enforces the admin check per request.
export default function RwaIndexPage() {
  return <RwaIndex variant="page" />;
}
