'use client';
import Link from 'next/link';

export default function Sidebar() {
  return (
    <div className="w-64 bg-white dark:bg-gray-800 border-r dark:border-gray-700 fixed h-full p-4 flex flex-col">
      <div className="text-2xl font-bold text-furlpay-600 mb-8 px-2">FurlPay</div>
      
      <nav className="flex-1 space-y-1">
        <Link href="/" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">Dashboard</Link>
        <Link href="/payments" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">Payments</Link>
        <Link href="/analytics" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">Analytics</Link>
        <Link href="/payouts" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">Payouts</Link>
        <Link href="/disputes" className="block px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">Disputes</Link>
      </nav>

      <div className="mt-auto space-y-1">
        <Link href="/settings" className="block px-4 py-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">Settings</Link>
        <Link href="/settings/api-keys" className="block px-4 py-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">API Keys</Link>
        <Link href="/settings/webhooks" className="block px-4 py-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">Webhooks</Link>
      </div>
    </div>
  );
}
