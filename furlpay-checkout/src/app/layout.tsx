import type { Metadata } from "next";
import "./globals.css"; // assuming standard nextjs setup

export const metadata: Metadata = {
  title: "FurlPay Checkout",
  description: "Fast Solana Payments",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-gray-50 text-gray-900">
        <header className="w-full p-4 flex items-center justify-center border-b bg-white">
          <h1 className="text-xl font-bold tracking-tight text-blue-600">FurlPay</h1>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
