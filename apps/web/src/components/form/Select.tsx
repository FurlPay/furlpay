"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

// The app's themed select. A native <select> hands its option list to the
// operating system, which ignores the dark theme on several platforms (and
// the old `[&>option]:text-black` workaround made it a white menu on purpose).
// This renders the list itself, so the open state matches every other surface.
//
// Pattern: select-only combobox (WAI-ARIA APG). Focus stays on the trigger and
// aria-activedescendant tracks the highlighted option. The list is portalled
// into the nearest open <dialog> (so it shares the dialog's top layer) or
// <body>, which is what keeps it from being clipped by an `overflow: hidden`
// parent or trapped under a sibling's stacking context. It opens below the
// trigger, or above when there is more room there, and re-measures on scroll,
// resize and the mobile visual viewport.
//
// Do NOT use it inside a popover that closes on outside clicks: the list lives
// outside that popover's DOM, so a click on an option reads as "outside".
// Keep a native <select> there; the global option colours in globals.css keep
// it dark.

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectClasses = { trigger: string; value: string; placeholder: string; chevron: string; icon: string; list: string; option: string };

export const SELECT_CLASSES: Record<"sm" | "md", SelectClasses> = {
  sm: {
    trigger:
      "flex h-9 w-full min-w-0 items-center gap-2 rounded-[10px] border border-white/[0.10] bg-white/[0.04] px-3 text-left text-[12.5px] font-semibold text-white transition-colors hover:border-white/[0.18] focus-visible:border-neon/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon/25 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:border-neon/50 aria-[invalid=true]:border-red-400/70",
    value: "min-w-0 flex-1 truncate",
    placeholder: "text-white/45 font-medium",
    chevron: "h-4 w-4 shrink-0 text-white/50 transition-transform duration-150 data-[open=true]:rotate-180",
    icon: "inline-flex shrink-0 text-neon",
    list: "z-[70] overflow-y-auto overscroll-contain rounded-xl border border-white/[0.10] bg-[#0B100E] p-1 text-[13px] text-white shadow-[0_18px_44px_rgba(0,0,0,0.6)] transition-opacity duration-100 data-[open=false]:pointer-events-none data-[open=false]:opacity-0 [scrollbar-color:#2a3a33_transparent] [scrollbar-width:thin]",
    option:
      "flex min-h-[36px] cursor-pointer select-none items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-white/85 transition-colors data-[active=true]:bg-white/[0.06] data-[active=true]:text-white aria-selected:bg-neon/10 aria-selected:font-semibold aria-selected:text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-40 [&>svg]:text-neon",
  },
  md: {
    trigger:
      "flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-white/[0.10] bg-black/30 px-3 text-left text-sm text-white transition-colors hover:border-white/[0.18] focus-visible:border-neon/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon/25 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:border-neon/50 aria-[invalid=true]:border-red-400/70",
    value: "min-w-0 flex-1 truncate",
    placeholder: "text-white/45",
    chevron: "h-4 w-4 shrink-0 text-white/50 transition-transform duration-150 data-[open=true]:rotate-180",
    icon: "inline-flex shrink-0 text-neon",
    list: "z-[70] overflow-y-auto overscroll-contain rounded-xl border border-white/[0.10] bg-[#0B100E] p-1 text-sm text-white shadow-[0_18px_44px_rgba(0,0,0,0.6)] transition-opacity duration-100 data-[open=false]:pointer-events-none data-[open=false]:opacity-0 [scrollbar-color:#2a3a33_transparent] [scrollbar-width:thin]",
    option:
      "flex min-h-[40px] cursor-pointer select-none items-center justify-between gap-3 rounded-lg px-3 py-2 text-white/85 transition-colors data-[active=true]:bg-white/[0.06] data-[active=true]:text-white aria-selected:bg-neon/10 aria-selected:font-semibold aria-selected:text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-40 [&>svg]:text-neon",
  },
};

type Props = {
  id?: string;
  value: string;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  /** Visible label element's id. Use this or `ariaLabel`. */
  labelId?: string;
  ariaLabel?: string;
  placeholder?: string;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  icon?: ReactNode;
  size?: "sm" | "md";
  /** Full class set, for surfaces with their own design tokens. */
  classes?: SelectClasses;
  /** Extra classes on the trigger (width, margins). */
  className?: string;
  /** Menu width when wider than the trigger, e.g. a compact sort control. */
  minMenuWidth?: number;
};

export default function Select({
  id: idProp, value, options, onValueChange, labelId, ariaLabel, placeholder = "Select an option", required, invalid, describedBy,
  disabled, icon, size = "sm", classes, className = "", minMenuWidth = 0,
}: Props) {
  const c = classes ?? SELECT_CLASSES[size];
  // useId, not a module counter: the server and client must agree on the id
  // or hydration fails. Its colons are fine in an id but not in a selector.
  const fallbackId = `fp-select-${useId().replace(/:/g, "")}`;
  const id = idProp ?? fallbackId;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<{ style: CSSProperties; side: "above" | "below" } | null>(null);
  const typeahead = useRef({ value: "", time: 0 });
  const selected = options.findIndex((o) => o.value === value);
  const enabled = (i: number) => i >= 0 && i < options.length && !options[i].disabled;
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (enabled(i)) return i;
    return from;
  };
  const first = () => step(-1, 1);
  const last = () => step(options.length, -1);

  const close = useCallback(() => setOpen(false), []);
  const show = (toLast = false) => {
    if (disabled) return;
    setHost(trigger.current?.closest("dialog") ?? document.body);
    setActive(enabled(selected) ? selected : toLast ? last() : first());
    setMounted(true);
    setOpen(true);
  };
  const choose = (index: number) => {
    if (!enabled(index)) return;
    onValueChange(options[index].value);
    close();
    trigger.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => { setMounted(false); setPlacement(null); }, 120);
    return () => window.clearTimeout(timer);
  }, [open]);
  useEffect(() => { if (disabled) close(); }, [disabled, close]);

  useLayoutEffect(() => {
    if (!open || !host || !trigger.current) return;
    const position = () => {
      const anchor = trigger.current!.getBoundingClientRect();
      const box = host.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = (viewport?.offsetTop ?? 0) + 12;
      const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 12;
      const viewportLeft = (viewport?.offsetLeft ?? 0) + 12;
      const viewportRight = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - 12;
      const gap = 6;
      const below = viewportBottom - anchor.bottom - gap;
      const above = anchor.top - viewportTop - gap;
      const side = below >= Math.min(280, options.length * 40 + 12) || below >= above ? "below" : "above";
      const maxHeight = Math.min(320, Math.max(0, side === "below" ? below : above));
      const height = Math.min(menu.current?.scrollHeight ?? 320, maxHeight);
      // Never wider than the viewport, and shifted left when it would run off
      // the right edge (a compact sort control near the edge of the screen).
      const width = Math.min(Math.max(anchor.width, minMenuWidth), viewportRight - viewportLeft);
      const left = Math.max(viewportLeft, Math.min(anchor.left, viewportRight - width));
      setPlacement({
        side,
        style: {
          position: "absolute",
          left: left - box.left,
          top: (side === "below" ? anchor.bottom + gap : anchor.top - gap - height) - box.top,
          width,
          maxHeight,
          visibility: anchor.bottom < viewportTop || anchor.top > viewportBottom ? "hidden" : "visible",
        },
      });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(trigger.current);
    observer.observe(host);
    const scroll = (event: Event) => { if (event.target !== menu.current) position(); };
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [open, host, options.length, close, minMenuWidth]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open) return;
    const list = menu.current;
    const item = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!item || !list) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  }, [active, open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        id={id}
        role="combobox"
        className={`${c.trigger} ${className}`}
        disabled={disabled}
        aria-label={labelId ? undefined : ariaLabel}
        aria-labelledby={labelId ? `${labelId} ${id}-value` : undefined}
        aria-controls={open ? `${id}-list` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        onClick={() => (open ? close() : show())}
        onBlur={close}
        onKeyDown={(event) => {
          const key = event.key;
          if (key === "Tab") { close(); return; }
          if (key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
          if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(key)) {
            event.preventDefault();
            event.stopPropagation();
            if (!open) { show(key === "ArrowUp" || key === "End"); return; }
            if (key === "Enter" || key === " ") { choose(active); return; }
            setActive((i) => (key === "Home" ? first() : key === "End" ? last() : step(i, key === "ArrowDown" ? 1 : -1)));
          } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            const now = Date.now();
            typeahead.current.value = now - typeahead.current.time > 700 ? key : typeahead.current.value + key;
            typeahead.current.time = now;
            const query = typeahead.current.value.toLocaleLowerCase();
            const match = options.findIndex((o, i) => enabled(i) && o.label.toLocaleLowerCase().startsWith(query));
            if (!open) show();
            if (match >= 0) setActive(match);
          }
        }}
      >
        {icon && <span className={c.icon} aria-hidden="true">{icon}</span>}
        <span id={`${id}-value`} className={`${c.value} ${selected < 0 ? c.placeholder : ""}`}>
          {options[selected]?.label ?? placeholder}
        </span>
        <ChevronDown className={c.chevron} data-open={open} aria-hidden="true" />
      </button>
      {mounted &&
        host &&
        createPortal(
          <div
            ref={menu}
            id={`${id}-list`}
            role="listbox"
            aria-labelledby={labelId}
            aria-label={labelId ? undefined : ariaLabel}
            aria-hidden={!open || undefined}
            className={c.list}
            data-open={open}
            data-side={placement?.side}
            style={placement?.style ?? { position: "absolute", visibility: "hidden" }}
            // Keep focus on the trigger for every pointer type. Cancelling pointerdown
            // suppresses the compatibility mousedown that would otherwise blur the
            // trigger (and close the list) between a touch's pointerup and its click;
            // it does not stop touch scrolling, which touch-action governs.
            onPointerDown={(event) => event.preventDefault()}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={value === option.value}
                aria-disabled={option.disabled || undefined}
                className={c.option}
                data-index={index}
                data-active={active === index}
                onPointerMove={(event) => { if (event.pointerType === "mouse" && enabled(index)) setActive(index); }}
                onClick={() => choose(index)}
              >
                <span className="min-w-0">{option.label}</span>
                <Check size={15} className={value === option.value ? "shrink-0" : "invisible shrink-0"} aria-hidden="true" />
              </div>
            ))}
          </div>,
          host,
        )}
    </>
  );
}
