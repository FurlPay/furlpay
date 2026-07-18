// Travel skeleton — hero headline, search bar and destination-card grid
// matching the discovery page's max-w-6xl layout, so results stream in
// without a shift.
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-8">
      <div className="h-4 w-56 animate-pulse rounded bg-white/[0.06]" />
      <div className="mt-3 h-10 w-3/4 max-w-md animate-pulse rounded-lg bg-white/10" />
      <div className="mt-2 h-4 w-full max-w-xl animate-pulse rounded bg-white/[0.06]" />
      <div className="mt-5 h-14 w-full animate-pulse rounded-2xl bg-white/[0.07]" />
      <div className="mt-6 flex gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded-full bg-white/[0.06]" />
        ))}
      </div>
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-64 animate-pulse rounded-card bg-white/[0.05]" />
        ))}
      </div>
    </div>
  );
}
