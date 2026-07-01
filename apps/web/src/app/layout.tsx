import type { Metadata, Viewport } from "next";
import "./globals.css";
import BottomNav from "@/components/BottomNav";

export const metadata: Metadata = {
  title: "Stablecoin Super-App",
  description: "Stripe + Robinhood + Wise + Coinbase + Revolut, for stablecoins.",
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
        {/* Phone-frame shell centered on larger screens. */}
        <div className="mx-auto min-h-screen w-full max-w-[440px] bg-oled">
          <main className="pb-28">{children}</main>
          <BottomNav />
        </div>
      </body>
    </html>
  );
}
