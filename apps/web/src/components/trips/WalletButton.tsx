"use client";

import { useEffect, useRef } from "react";
import { MoreHorizontal, Share2, Ticket, Info } from "lucide-react";
import { AppleWalletIcon } from "./icons";

/**
 * Add-to-Wallet action plus its overflow menu. The menu is a real popover —
 * click-away and Escape both close it — rather than a decorative dot cluster.
 */
export default function WalletButton({
  onAdd,
  added = false,
  menuOpen = false,
  onToggleMenu,
  onCloseMenu,
  onShowDetails,
}: {
  onAdd?: () => void;
  added?: boolean;
  menuOpen?: boolean;
  onToggleMenu?: () => void;
  onCloseMenu?: () => void;
  onShowDetails?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onCloseMenu?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseMenu?.();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, onCloseMenu]);

  return (
    <div ref={wrapRef} className="relative mx-[14px] mt-[10px] flex items-center gap-[12px]">
      <button
        type="button"
        onClick={onAdd}
        className="flex flex-1 items-center gap-[14px] rounded-full bg-fp-dark px-[16px] py-[11px] text-left transition-[transform,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-[#1c2320] active:scale-[0.985] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fp-ink"
      >
        <AppleWalletIcon className="h-[30px] w-[38px] shrink-0" />
        <span className="text-[17px] font-medium leading-[1.18] tracking-[-0.01em] text-white">
          {added ? (
            <>
              Added to
              <br />
              Apple Wallet
            </>
          ) : (
            <>
              Add to
              <br />
              Apple Wallet
            </>
          )}
        </span>
      </button>

      <button
        type="button"
        onClick={onToggleMenu}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="More trip options"
        className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-full bg-[#EBEBED] text-[#3C3C43] transition-[background-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-[#E0E0E3] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fp-ink"
      >
        <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2.5} />
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute bottom-[62px] right-0 z-30 w-[212px] overflow-hidden rounded-[16px] bg-white/95 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl"
        >
          <MenuItem icon={<Ticket className="h-[17px] w-[17px]" />} label="Flight details" onClick={onShowDetails} />
          <MenuItem icon={<Share2 className="h-[17px] w-[17px]" />} label="Share boarding pass" onClick={onCloseMenu} />
          <MenuItem icon={<Info className="h-[17px] w-[17px]" />} label="Airport guide" onClick={onCloseMenu} />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-[11px] border-b border-black/[0.06] px-[15px] py-[12px] text-left text-[15px] text-[#111113] transition-colors duration-[var(--dur-fast)] last:border-b-0 hover:bg-black/[0.04]"
    >
      <span className="text-[#6E6E73]">{icon}</span>
      {label}
    </button>
  );
}
