import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'FurlPay Dashboard',
  description: 'Merchant dashboard for FurlPay Solana payments',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex min-h-screen font-sans">
        <Sidebar />
        <main className="flex-1 p-8 ml-64 overflow-y-auto">
          {children}
        </main>
      </body>
    </html>
  );
}
