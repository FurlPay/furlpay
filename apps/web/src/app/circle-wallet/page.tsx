import type { Metadata } from "next";
import CircleWalletPanel from "@/components/wallets/CircleWalletPanel";

// Circle user-controlled wallet. Session-gated by middleware (not in
// PUBLIC_PAGE_PREFIXES — /wallet is public, which is why this is not
// /wallet/circle). The panel fetches through /api/wallets/circle*, which
// resolve the user from the session; nothing here takes a user id.
export const metadata: Metadata = {
  title: "Circle wallet",
  robots: { index: false, follow: false },
};

export default function CircleWalletPage() {
  return <CircleWalletPanel />;
}
