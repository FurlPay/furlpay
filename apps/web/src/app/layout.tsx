import type { Metadata, Viewport } from "next";
import "./globals.css";
import Shell from "@/components/Shell";

export const metadata: Metadata = {
  title: "Furlpay — The On-Chain Financial Operating System",
  description:
    "Fusing stablecoin payments, global local accounts, and fractional stock investing into one beautiful web & desktop client. Phishing-resistant. Compliance-aware. Zero gas.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Shell picks full-bleed (marketing/docs) vs phone-frame app chrome. */}
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
