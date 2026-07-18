// Investing skeleton — portfolio hero (value + stat grid), chart region and
// holdings rows, mirroring the page so hydration lands without a shift.
export default function Loading() {
  return (
    <div className="pb-24 pt-8">
      <div className="px-5">
        <div className="flex items-center justify-between">
          <div className="h-7 w-32 animate-pulse rounded-lg bg-white/10" />
          <div className="h-6 w-24 animate-pulse rounded-full bg-white/[0.06]" />
        </div>
        <div className="mt-6 animate-pulse rounded-card bg-white/[0.05] p-5">
          <div className="h-4 w-28 rounded bg-white/[0.08]" />
          <div className="mt-2 h-10 w-44 rounded-lg bg-white/10" />
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-2xl bg-white/[0.06]" />
            ))}
          </div>
        </div>
        <div className="mt-6 h-44 animate-pulse rounded-card bg-white/[0.05]" />
        <div className="mt-8 space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      </div>
    </div>
  );
}
