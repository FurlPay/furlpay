import NewsletterSignup from "@/components/newsletter/NewsletterSignup";

export default function NewsletterBanner() {
  return (
    <div className="glow-border rounded-card p-[1px]">
      <div className="rounded-card bg-white/[0.03] px-6 py-8 backdrop-blur-xl sm:px-8 sm:py-10">
        <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">
          Don&apos;t miss the next one
        </p>
        <h3 className="mt-2 text-[22px] font-extrabold tracking-tighter sm:text-[26px]">
          Stay ahead of the curve
        </h3>
        <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-textSecondary">
          Get product updates, engineering deep-dives, and security bulletins.
          No spam — just the signal.
        </p>
        <div className="mt-5">
          <NewsletterSignup variant="minimal" />
        </div>
      </div>
    </div>
  );
}
