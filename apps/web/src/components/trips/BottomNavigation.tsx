"use client";

import { House, Briefcase, CircleDollarSign, CreditCard, UserRound } from "lucide-react";

// `solidWhenActive` is per-tab, not global. A filled briefcase still reads as a
// briefcase; a filled house, card or coin collapses into a green blob, because
// their glyphs are defined by the counters the fill swallows.
export const TRIPS_TABS = [
  { id: "home", label: "Home", Icon: House, solidWhenActive: false },
  { id: "trips", label: "Trips", Icon: Briefcase, solidWhenActive: true },
  { id: "pay", label: "Pay", Icon: CircleDollarSign, solidWhenActive: false },
  { id: "cards", label: "Cards", Icon: CreditCard, solidWhenActive: false },
  { id: "profile", label: "Profile", Icon: UserRound, solidWhenActive: false },
] as const;

export type TabId = (typeof TRIPS_TABS)[number]["id"];

/** Floating iOS tab bar. The active tab is filled and green; the rest are line icons. */
export default function BottomNavigation({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (id: TabId) => void;
}) {
  return (
    <nav
      aria-label="FurlPay"
      className="mt-auto flex items-start justify-around rounded-t-[30px] bg-[#E3E3E5] px-[10px] pb-[18px] pt-[12px]"
    >
      {TRIPS_TABS.map(({ id, label, Icon, solidWhenActive }) => {
        const on = id === active;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={on ? "page" : undefined}
            className="flex w-full max-w-[64px] flex-col items-center gap-[6px] rounded-xl py-1 transition-[color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fp-ink"
            style={{ color: on ? "#1B7A4E" : "#8B8B90" }}
          >
            <Icon
              className="h-[26px] w-[26px]"
              strokeWidth={on ? 2.1 : 1.6}
              fill={on && solidWhenActive ? "currentColor" : "none"}
            />
            <span className={`text-[12px] leading-none ${on ? "font-semibold" : "font-normal"}`}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
