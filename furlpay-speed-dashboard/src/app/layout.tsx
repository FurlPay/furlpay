import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FurlPay Speed Dashboard",
  description: "Live performance metrics for FurlPay on Solana",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-black text-white min-h-screen">
        <header className="p-6 border-b border-gray-800 flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
            FurlPay Network
          </h1>
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <span>Powered by Solana</span>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
