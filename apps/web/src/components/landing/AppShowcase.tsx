import StoreBadges from "@/components/marketing/StoreBadges";
import WalletCardTeaser from "./WalletCardTeaser";
import { editionLabel } from "@/components/card/edition";

/*
 * "Ship it, then carry it." The product surfaces a reader can actually touch:
 * the mobile app (the existing capture, kept), where to get it, and the wallet
 * card. Deliberately placed above the rails marquee so the page moves from
 * "here is the API" to "here is the product" before it talks about partners.
 */
export default function AppShowcase() {
  return (
    <section className="section section-y-sm" aria-labelledby="app-showcase-title">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
        {/* Phone capture — muted + playsInline is what lets browsers autoplay. */}
        <div className="flex justify-center">
          <div className="relative w-[260px] overflow-hidden rounded-[2rem] border border-white/15 bg-black shadow-[0_0_80px_-20px_rgba(0,229,153,0.25)] sm:w-[300px]">
            <video
              src="/media/travels-phone.mp4"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-label="FurlPay Travels running in the mobile app"
              className="block h-auto w-full"
            />
          </div>
        </div>

        <div>
          <p className="section-eyebrow">Apps</p>
          <h2 className="section-title mt-3" id="app-showcase-title">
            The same rails, in your pocket.
          </h2>
          <p className="section-lede mt-4">
            Mobile, desktop and web share one account, one balance and one set of spending
            controls — the same API surface your integration talks to.
          </p>

          <div className="mt-8">
            <StoreBadges />
          </div>

          <div className="mt-10 flex justify-center lg:justify-start">
            <WalletCardTeaser initialEdition={editionLabel(new Date())} />
          </div>
        </div>
      </div>
    </section>
  );
}
