import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import WalletConsent from "./WalletConsent";
import "../wallet.css";

export const metadata: Metadata = {
  title: "Authorize FurlPay Wallet",
  description: "Authorize FurlPay Wallet to reserve your name",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#00E599",
};

export default function WalletAuthorizePage() {
  return (
    <Suspense fallback={null}>
      <WalletConsent />
    </Suspense>
  );
}
