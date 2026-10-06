import { Building2, Gift, MapPin, Plane, Wallet } from "lucide-react";
import { HOME_IMAGES } from "@/lib/travel/home";
import HeroTripCard, { type HeroTrip } from "./HeroTripCard";

export interface HeroMetric {
  icon: "stays" | "flights" | "pay" | "cashback";
  value: string;
  label: string;
}

const ICONS = { stays: Building2, flights: Plane, pay: Wallet, cashback: Gift } as const;

/** Cinematic hero: Santorini at dusk under a left-to-right scrim, headline,
 *  four compact metrics, and the floating trip card. Server-rendered; only
 *  the trip carousel is a client island. */
export default function HomeHero({ metrics, trips, children }: { metrics: HeroMetric[]; trips: HeroTrip[]; children?: React.ReactNode }) {
  return (
    <section className="relative -mt-16 overflow-hidden pt-16">
      <div className="absolute inset-0 -z-10">
        <img src={HOME_IMAGES.hero} alt="" fetchPriority="high" className="h-full w-full object-cover object-[65%_40%]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#030505] via-[#030505]/80 to-[#030505]/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#030505] via-transparent to-[#030505]/40" />
      </div>

      <div className="mx-auto max-w-[1400px] px-4 pb-6 pt-10 sm:px-6 lg:px-10 lg:pt-16">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-[620px]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neon">FurlPay Travel</p>
            <h1 className="mt-4 text-[44px] font-extrabold leading-[0.98] tracking-[-0.03em] text-white sm:text-[60px] lg:text-[74px]">
              Plan anywhere.
              <br />
              Book anything.
              <br />
              <span className="text-neon">Pay your way.</span>
            </h1>
            <p className="mt-5 max-w-[560px] text-[15px] leading-relaxed text-white/80 sm:text-[16px]">
              Stays, flights, cars, activities and more — powered by AI, booked in one place. Pay with USDC, SOL, BTC,
              100+ tokens or cards, and earn 2% USDC cashback once travel rewards launch.
            </p>

            <ul className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-8">
              {metrics.map((m) => {
                const Icon = ICONS[m.icon];
                return (
                  <li key={m.label} className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neon/30 bg-neon/10 text-neon">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="leading-tight">
                      <span className="block text-[13px] font-semibold text-white">{m.value}</span>
                      <span className="block text-[11px] text-white/55">{m.label}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="relative hidden shrink-0 items-end gap-6 md:flex">
            <span className="absolute -top-28 left-0 hidden items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-[11px] text-white/85 backdrop-blur lg:flex">
              <MapPin className="h-3.5 w-3.5" aria-hidden /> Santorini, Greece
            </span>
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

        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}
