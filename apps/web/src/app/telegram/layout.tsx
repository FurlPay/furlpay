import type { Metadata, Viewport } from "next";
import TelegramProvider from "@/components/telegram/TelegramProvider";
import AppShell from "@/components/telegram/AppShell";
import "./telegram.css";

export const metadata: Metadata = {
  title: "FurlPay Telegram Mini App", description: "Your FurlPay account, cards preview, assets, and activity — together in Telegram.",
  robots: { index: false, follow: false }, referrer: "no-referrer", alternates: { canonical: "/telegram" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#080a0d", colorScheme: "dark" };
export default function TelegramLayout({ children }: { children: React.ReactNode }) {
  return <TelegramProvider><AppShell>{children}</AppShell></TelegramProvider>;
}
