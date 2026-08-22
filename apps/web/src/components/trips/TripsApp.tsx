"use client";

import { useState } from "react";
import Link from "next/link";
import IOSStatusBar from "./IOSStatusBar";
import FlightLiveActivity from "./FlightLiveActivity";
import TripCard from "./TripCard";
import BoardingPass from "./BoardingPass";
import WalletButton from "./WalletButton";
import BottomNavigation, { TRIPS_TABS, type TabId } from "./BottomNavigation";
import type { Trip } from "@/lib/trips/demoTrip";

/**
 * The FurlPay Trips screen that runs inside the device mockup — a real
 * component tree, not a screenshot, so it stays responsive and operable.
 *
 * Only Trips is built out. The other four tabs switch and say so rather than
 * inventing a balance or a card list: a marketing preview must never show
 * numbers a visitor could mistake for their own.
 */
export default function TripsApp({ trip }: { trip: Trip }) {
  const [tab, setTab] = useState<TabId>("trips");
  const [passExpanded, setPassExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addedToWallet, setAddedToWallet] = useState(false);

  return (
    <div className="flex h-full flex-col bg-[#F2F2F4] text-[#111113] antialiased max-sm:h-auto">
      <IOSStatusBar />

      {tab === "trips" ? (
        <div className="no-scrollbar flex flex-1 flex-col overflow-y-auto pb-[10px] max-sm:overflow-visible">
          <FlightLiveActivity trip={trip} onOpen={() => setPassExpanded(true)} />

          <div className="mt-[12px]">
            <TripCard trip={trip} onOpen={() => setPassExpanded((v) => !v)} />
            <BoardingPass
              trip={trip}
              expanded={passExpanded}
              onToggle={() => setPassExpanded((v) => !v)}
            />
          </div>

          <WalletButton
            added={addedToWallet}
            onAdd={() => setAddedToWallet(true)}
            menuOpen={menuOpen}
            onToggleMenu={() => setMenuOpen((v) => !v)}
            onCloseMenu={() => setMenuOpen(false)}
            onShowDetails={() => {
              setPassExpanded(true);
              setMenuOpen(false);
            }}
          />
        </div>
      ) : (
        <OtherTab tab={tab} />
      )}

      <BottomNavigation active={tab} onChange={setTab} />
    </div>
  );
}

function OtherTab({ tab }: { tab: TabId }) {
  const meta = TRIPS_TABS.find((t) => t.id === tab)!;
  const { Icon, label } = meta;
  return (
    <div className="flex min-h-[460px] flex-1 flex-col items-center justify-center px-[36px] text-center">
      <span className="flex h-[62px] w-[62px] items-center justify-center rounded-[20px] bg-[#E3E3E5] text-[#8B8B90]">
        <Icon className="h-[28px] w-[28px]" strokeWidth={1.6} />
      </span>
      <p className="mt-[18px] text-[21px] font-semibold tracking-[-0.02em]">{label}</p>
      <p className="mt-[9px] text-[15px] leading-[1.45] text-[#6E6E73]">
        This preview covers the Trips tab. {label} lives in the FurlPay app.
      </p>
      <Link
        href="/dashboard"
        className="mt-[20px] rounded-full bg-fp-ink px-[20px] py-[11px] text-[15px] font-semibold text-white transition-colors duration-[var(--dur-fast)] hover:bg-fp-inkDeep"
      >
        Open FurlPay
      </Link>
    </div>
  );
}
