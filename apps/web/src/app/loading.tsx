// Route-level loading UI — renders the app shell instantly while the page
// streams in, improving perceived performance (LCP) over a blank screen.
export default function Loading() {
  return (
    <div className="px-5 pt-8">
      <div className="h-8 w-40 animate-pulse rounded-lg bg-white/10" />
      <div className="mt-6 h-14 w-56 animate-pulse rounded-lg bg-white/10" />
      <div className="mt-6 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-card bg-white/[0.06]" />
        ))}
      </div>
      <div className="mt-8 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-2xl bg-white/[0.04]" />
        ))}
      </div>
    </div>
  );
}
