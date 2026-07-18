// Dashboard skeleton — mirrors the page's layout (greeting, net-worth figure,
// action row, balances, transaction list) so hydration lands without a shift.
export default function Loading() {
  return (
    <div className="px-5 pb-24 pt-8">
      <div className="flex items-center justify-between">
        <div className="h-7 w-44 animate-pulse rounded-lg bg-white/10" />
        <div className="h-10 w-10 animate-pulse rounded-full bg-white/[0.08]" />
      </div>
      <div className="mt-6 h-12 w-52 animate-pulse rounded-lg bg-white/10" />
      <div className="mt-2 h-4 w-32 animate-pulse rounded bg-white/[0.06]" />
      <div className="mt-6 grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-card bg-white/[0.06]" />
        ))}
      </div>
      <div className="mt-6 h-40 animate-pulse rounded-card bg-white/[0.05]" />
      <div className="mt-8 space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-2xl bg-white/[0.04]" />
        ))}
      </div>
    </div>
  );
}
