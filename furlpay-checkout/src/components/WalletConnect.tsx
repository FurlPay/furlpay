"use client";

export default function WalletConnect({ session }: { session: any }) {
  return (
    <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-colors">
      Pay with Wallet
    </button>
  );
}
