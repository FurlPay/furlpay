// Cards skeleton — card-shaped hero (the carousel's aspect ratio) plus the
// settings rows underneath, so the real card art streams in without a shift.
export default function Loading() {
  return (
    <div className="px-5 pb-24 pt-8">
      <div className="flex items-center justify-between">
        <div className="h-7 w-28 animate-pulse rounded-lg bg-white/10" />
        <div className="h-10 w-10 animate-pulse rounded-full bg-white/[0.08]" />
      </div>
      <div className="mt-6 aspect-[1.586] w-full animate-pulse rounded-3xl bg-white/[0.08]" />
      <div className="mt-3 flex justify-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/25" />
        ))}
      </div>
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
