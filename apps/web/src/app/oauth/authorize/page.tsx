import { Suspense } from "react";
import ConsentClient from "./ConsentClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Connect FurlPay",
  robots: { index: false, follow: false },
};

// /oauth/authorize — the consent screen an MCP client (Claude) sends the user
// to. Server component shell; the decision itself is a client component that
// POSTs to /api/oauth/authorize with the session cookie.
export default function AuthorizePage() {
  return (
    <Suspense fallback={null}>
      <ConsentClient />
    </Suspense>
  );
}
