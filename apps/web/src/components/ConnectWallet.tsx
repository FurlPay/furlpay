"use client";

import { useState } from "react";
import Image from "next/image";
import { Wallet } from "lucide-react";
import { useDiscoveredWallets, type EIP6963ProviderDetail } from "@/lib/wallet/mipd";

// EIP-6963 wallet connect — lists every announced wallet (FurlPay extension,
// MetaMask, …) instead of grabbing whatever won the window.ethereum race.
export default function ConnectWallet() {
  const wallets = useDiscoveredWallets();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(w: EIP6963ProviderDetail) {
    setBusy(true);
    setError(null);
    try {
      const accounts = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts?.[0]) {
        setAddress(accounts[0]);
        setOpen(false);
      }
    } catch (e) {
      setError((e as Error)?.message || "Connection rejected.");
    } finally {
      setBusy(false);
    }
  }

  if (address) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/70">
        <Wallet size={13} className="text-green-400" />
        {address.slice(0, 6)}…{address.slice(-4)}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] text-white/70 hover:text-white"
      >
        <Wallet size={13} /> Connect wallet
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-white/10 bg-[#12131a] p-2 shadow-xl">
          {wallets.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-white/40">
              No EIP-6963 wallets found. Install the FurlPay extension to connect here.
            </p>
          ) : (
            wallets.map((w) => (
              <button
                key={w.info.uuid}
                onClick={() => connect(w)}
                disabled={busy}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] text-white/80 hover:bg-white/[0.05] disabled:opacity-40"
              >
                {/* EIP-6963 icons are data URIs — next/image can't optimize them */}
                <Image
                  src={w.info.icon}
                  alt=""
                  width={22}
                  height={22}
                  unoptimized
                  className="rounded-md"
                />
                <span>{w.info.name}</span>
                <span className="ml-auto text-[10px] text-white/30">{w.info.rdns}</span>
              </button>
            ))
          )}
          {error && <p className="px-3 py-2 text-[11px] text-loss">{error}</p>}
        </div>
      )}
    </div>
  );
}
