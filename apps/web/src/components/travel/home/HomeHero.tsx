import { Building2, Gift, Plane, Wallet } from "lucide-react";
import HeroTripCard, { type HeroTrip } from "./HeroTripCard";
import { HeroBackdrop, HeroLocationChip, HeroMotionProvider } from "./HeroMotion";

export interface HeroMetric {
  icon: "stays" | "flights" | "pay" | "cashback";
  value: string;
  label: string;
}

const ICONS = { stays: Building2, flights: Plane, pay: Wallet, cashback: Gift } as const;

/** Cinematic hero: rotating destination photography (lib/travel/heroSlides)
 *  under a left-to-right scrim, headline, four compact metrics, and the
 *  sliding trip carousel. The copy, metrics and search form stay
 *  server-rendered; only the backdrop, location label and carousel are
 *  client islands, sharing one HeroMotionProvider. */
export default function HomeHero({ metrics, trips, children }: { metrics: HeroMetric[]; trips: HeroTrip[]; children?: React.ReactNode }) {
  return (
    // `isolate` gives the section its own stacking context, so the -z-10
    // photo sits behind the content but above the layout's background.
    <section className="relative isolate -mt-16 overflow-hidden pt-16">
      <HeroMotionProvider>
        <HeroBackdrop />

        <div className="mx-auto max-w-[1400px] px-4 pb-6 pt-10 sm:px-6 lg:px-10 lg:pt-16">
          <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 max-w-[720px]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neon">FurlPay Travel</p>
              <h1 className="mt-4 text-[38px] font-extrabold leading-[0.98] tracking-[-0.03em] text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.35)] min-[360px]:text-[42px] sm:text-[58px] lg:text-[64px] xl:text-[74px]">
                Plan anywhere.
                <br />
                Book anything.
                <br />
                <span className="text-neon">Pay your way.</span>
              </h1>
              <p className="mt-5 max-w-[560px] text-[15px] leading-relaxed text-white/80 [text-shadow:0_1px_12px_rgba(0,0,0,0.45)] sm:text-[16px]">
                Stays, flights, cars, activities and more — powered by AI, booked in one place. Pay with USDC, SOL, BTC,
                100+ tokens or cards, and earn 2% USDC cashback once travel rewards launch.
              </p>

              <ul className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-6 xl:flex-nowrap">
                {metrics.map((m) => {
                  const Icon = ICONS[m.icon];
                  return (
                    <li key={m.label} className="flex min-w-0 items-center gap-3 sm:whitespace-nowrap">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neon/30 bg-neon/10 text-neon">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 leading-tight">
                        <span className="block text-[13px] font-semibold text-white">{m.value}</span>
                        <span className="block text-[11px] text-white/55">{m.label}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>

              {/* Below lg the location label sits under the metrics. */}
              <HeroLocationChip className="mt-6 flex lg:hidden" />
            </div>

            <div className="relative hidden shrink-0 items-end gap-6 md:flex">
              <HeroLocationChip className="absolute -top-14 left-0 hidden lg:flex" />
              <HeroTripCard trips={trips} />
              <p aria-hidden className="hidden pb-8 font-serif text-[30px] italic leading-[1.05] text-white/85 [text-shadow:0_2px_12px_rgba(0,0,0,0.6)] 2xl:block">
                Travel
                <br />
                More
                <br />
                Freedom
              </p>
            </div>
          </div>

          <div className="mt-8 lg:mt-10">{children}</div>

          {/* Below md the floating card becomes an ordinary stacked card. */}
          <div className="mt-6 md:hidden">
            <HeroTripCard trips={trips} fluid />
          </div>
        </div>
      </HeroMotionProvider>
    </section>
  );
}
