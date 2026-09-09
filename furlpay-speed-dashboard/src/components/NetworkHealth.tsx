"use client";

export default function NetworkHealth() {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-300">Network Health</span>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
        <span className="text-emerald-500 font-medium">Healthy</span>
      </div>
    </div>
  );
}
