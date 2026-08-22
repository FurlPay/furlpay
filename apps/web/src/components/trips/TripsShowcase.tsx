"use client";

import { useState } from "react";
import HeroHeadline from "./HeroHeadline";
import LiveActivityBadge from "./LiveActivityBadge";
import LiveActivityCard from "./LiveActivityCard";
import FlightStatusCard from "./FlightStatusCard";
import PaymentRewardCard from "./PaymentRewardCard";
import IPhoneMockup from "./IPhoneMockup";
import TripsApp from "./TripsApp";
import styles from "./trips.module.css";
import type { Trip } from "@/lib/trips/demoTrip";

/**
 * The whole composition: marketing column on the left, live device on the
 * right. Column widths are the reference's own (384px of cards, a 38px gutter,
 * a 560px device) so at >=1122px the layout is the reference 1:1, and below
 * that the same grid compresses rather than reflows.
 */
export default function TripsShowcase({ trip }: { trip: Trip }) {
  // The compact Live Activity expands into the detailed status card below it —
  // the arrow between them is the affordance, the button is the control.
  const [detailOpen, setDetailOpen] = useState(true);

  return (
    <section className={`${styles.stage} min-h-screen w-full overflow-hidden`}>
      <div className={styles.environment} aria-hidden="true" />
      <div className={styles.mullions} aria-hidden="true" />
      <div className={styles.floor} aria-hidden="true" />
      <div className={styles.keyLight} aria-hidden="true" />
      <div className={styles.groundShadow} aria-hidden="true" />

      <div className="relative z-10 mx-auto grid max-w-[1122px] grid-cols-[minmax(0,1fr)] items-start gap-x-[38px] gap-y-16 px-6 pb-[116px] pt-[52px] sm:px-12 lg:grid-cols-[384px_minmax(0,1fr)]">
        <div className="w-full min-w-0 max-w-[440px] lg:max-w-none">
          <HeroHeadline />

          <div className="mt-[38px]">
            <LiveActivityBadge />
          </div>

          <div className="mt-[9px]">
            <LiveActivityCard
              trip={trip}
              expanded={detailOpen}
              onExpand={() => setDetailOpen((v) => !v)}
            />
          </div>

          {detailOpen && (
            <>
              <ExpandArrow />
              <FlightStatusCard trip={trip} />
            </>
          )}

          <div className="mt-[28px]">
            <PaymentRewardCard trip={trip} />
          </div>
        </div>

        <div className="flex w-full min-w-0 justify-center lg:mt-[46px] lg:justify-start">
          <IPhoneMockup>
            <TripsApp trip={trip} />
          </IPhoneMockup>
        </div>
      </div>
    </section>
  );
}

/** "…expands into" — the link between the compact and detailed cards. */
function ExpandArrow() {
  return (
    <svg
      viewBox="0 0 12 32"
      className="mx-auto my-[6px] h-[32px] w-[12px] text-white/55"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 1v28m0 0l-4.5-5M6 29l4.5-5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
