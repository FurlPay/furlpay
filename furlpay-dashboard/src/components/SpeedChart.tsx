export default function SpeedChart() {
  return (
    <div className="h-48 flex items-end justify-between gap-2 text-xs text-gray-500 mt-4 relative">
        <div className="absolute top-0 left-0 w-full h-full border-b border-l border-gray-200 dark:border-gray-700"></div>
        {/* Placeholder for actual chart bars */}
        <div className="w-full bg-furlpay-500/20 rounded-t h-3/4 relative z-10 hover:bg-furlpay-500/40 transition-colors"></div>
        <div className="w-full bg-furlpay-500/30 rounded-t h-4/5 relative z-10 hover:bg-furlpay-500/50 transition-colors"></div>
        <div className="w-full bg-furlpay-500/20 rounded-t h-2/3 relative z-10 hover:bg-furlpay-500/40 transition-colors"></div>
        <div className="w-full bg-furlpay-500/40 rounded-t h-full relative z-10 hover:bg-furlpay-500/60 transition-colors"></div>
        <div className="w-full bg-furlpay-500/30 rounded-t h-4/5 relative z-10 hover:bg-furlpay-500/50 transition-colors"></div>
        <div className="w-full bg-furlpay-500/20 rounded-t h-1/2 relative z-10 hover:bg-furlpay-500/40 transition-colors"></div>
        <div className="w-full bg-furlpay-500/30 rounded-t h-2/3 relative z-10 hover:bg-furlpay-500/50 transition-colors"></div>
    </div>
  );
}
