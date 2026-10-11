"use client";

import type { ReactNode } from "react";
import type { MapTheme } from "@/lib/hotels/mapStyle";

// View controls stacked under the zoom buttons: fullscreen, map theme and the
// density view. Every one is a real button with a name and a pressed state, so
// the map's view can be changed without a pointer.

function ControlButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`flex h-[42px] w-[42px] items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#00E6A7] ${
        pressed ? "bg-[rgba(0,230,167,0.12)] text-[#00E6A7]" : "text-[#C9CFCD] hover:bg-white/[0.05]"
      }`}
    >
      {children}
    </button>
  );
}

export default function MapViewControls({
  top,
  fullscreen,
  fullscreenSupported,
  onToggleFullscreen,
  theme,
  onToggleTheme,
  density,
  onToggleDensity,
  airports,
  onToggleAirports,
}: {
  top: number;
  fullscreen: boolean;
  fullscreenSupported: boolean;
  onToggleFullscreen: () => void;
  theme: MapTheme;
  onToggleTheme: () => void;
  density: boolean;
  onToggleDensity: () => void;
  airports: boolean;
  onToggleAirports: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Map view"
      className="absolute right-4 z-20 flex flex-col divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.06] bg-[#090D0E] shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
      style={{ top }}
    >
      {fullscreenSupported && (
        <ControlButton label={fullscreen ? "Exit full screen" : "Full screen map"} pressed={fullscreen} onClick={onToggleFullscreen}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {fullscreen ? (
              <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
            ) : (
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            )}
          </svg>
        </ControlButton>
      )}
      <ControlButton
        label={theme === "dark" ? "Switch to light map" : "Switch to dark map"}
        onClick={onToggleTheme}
      >
        {theme === "dark" ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden>
            <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
          </svg>
        )}
      </ControlButton>
      <ControlButton label="Show hotel density" pressed={density} onClick={onToggleDensity}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
          <circle cx="12" cy="12" r="8.5" opacity="0.35" />
          <circle cx="12" cy="12" r="5" opacity="0.65" />
          <circle cx="12" cy="12" r="1.8" fill="currentColor" />
        </svg>
      </ControlButton>
      <ControlButton label="Show airports" pressed={airports} onClick={onToggleAirports}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
          <path d="M10.5 21l1.5-1.2 1.5 1.2v-2l-1-1v-4.5l7 2.5v-2l-7-4.5V4.5a1 1 0 0 0-2 0V9L3.5 13.5v2l7-2.5V17l-1 1z" />
        </svg>
      </ControlButton>
    </div>
  );
}
