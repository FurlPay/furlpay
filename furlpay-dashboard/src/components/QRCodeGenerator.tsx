'use client';

export default function QRCodeGenerator({ address, amount }: { address?: string, amount?: string }) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-6 flex flex-col items-center bg-white dark:bg-gray-800">
      <div className="w-48 h-48 bg-gray-100 dark:bg-gray-900 border-4 border-white dark:border-gray-800 shadow-sm rounded-lg flex items-center justify-center mb-4">
        {/* Placeholder for actual QR Canvas/Image */}
        <span className="text-gray-400">QR Code</span>
      </div>
      <p className="font-mono text-sm text-gray-500 bg-gray-50 dark:bg-gray-900 px-3 py-1 rounded w-full text-center truncate">
        {address || 'Connect wallet to generate'}
      </p>
      {amount && <p className="mt-2 font-bold">{amount} SOL</p>}
    </div>
  );
}
