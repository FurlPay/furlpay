"use client";

export default function AlpenglowBanner() {
  return (
    <div className="bg-gradient-to-r from-purple-900/40 to-blue-900/40 border border-purple-500/30 rounded-lg p-4 flex items-center justify-between">
      <div>
        <h3 className="text-purple-300 font-semibold flex items-center gap-2">
          <span className="text-xl">🏔️</span> Alpenglow Synergy Active
        </h3>
        <p className="text-sm text-gray-300 mt-1">Solana network upgrades enabling sub-400ms finality.</p>
      </div>
      <div className="text-right">
        <div className="text-xs text-purple-400 uppercase tracking-wide">Status</div>
        <div className="text-emerald-400 font-bold">Enabled</div>
      </div>
    </div>
  );
}
