// Skeleton result cards — layout-stable loading state (perceived-performance
// pattern: the grid appears instantly instead of a spinner).
export default function SkeletonCards({ count = 6, imageH = "h-40" }: { count?: number; imageH?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading results">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-card border border-white/10 bg-charcoal">
          <div className={`${imageH} animate-pulse bg-white/[0.06]`} />
          <div className="space-y-2.5 p-4">
            <div className="h-4 w-3/4 animate-pulse rounded bg-white/[0.08]" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.06]" />
            <div className="flex items-end justify-between pt-2">
              <div className="h-6 w-20 animate-pulse rounded bg-white/[0.08]" />
              <div className="h-8 w-24 animate-pulse rounded-lg bg-white/[0.08]" />
            </div>
          </div>
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
