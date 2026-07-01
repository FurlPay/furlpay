"use client";

import { usePathname } from "next/navigation";
import BottomNav from "@/components/BottomNav";

// Layout switch. Marketing (/) and the docs portal (/docs*) render full-bleed
// so they can use the whole viewport; every other route keeps the phone-frame
// app chrome (centered 440px column + bottom tab bar).
const FULL_BLEED = (pathname: string) => pathname === "/" || pathname.startsWith("/docs");

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (FULL_BLEED(pathname)) {
    return <div className="min-h-screen bg-oled">{children}</div>;
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-[440px] bg-oled">
      <main className="pb-28">{children}</main>
      <BottomNav />
    </div>
  );
}
