"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

type Option = { value: string; label: string };
type Props = {
  id: string;
  labelId: string;
  value: string;
  options: readonly Option[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  icon?: ReactNode;
};

/** Select-only combobox. Focus stays on the trigger, while aria-activedescendant
 * tracks the keyboard option. The list is portalled inside the native dialog's
 * top layer, outside its scrolling panel. Position comes from live geometry;
 * resize, scroll and the mobile visual viewport all update its collision box.
 */
export default function PartnershipSelect({ id, labelId, value, options, onValueChange, placeholder = "Select an option", required, invalid, describedBy, disabled, icon }: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<{ style: CSSProperties; side: "above" | "below" } | null>(null);
  const typeahead = useRef({ value: "", time: 0 });
  // A touch on the list may move focus off the trigger before its click lands;
  // that blur must not close the list out from under the tap.
  const pressingMenu = useRef(false);
  const selected = options.findIndex(o => o.value === value);
  const close = useCallback(() => setOpen(false), []);
  const show = (last = false) => {
    if (disabled) return;
    setHost(trigger.current?.closest("dialog") ?? document.body);
    setActive(selected >= 0 ? selected : last ? options.length - 1 : 0);
    setMounted(true); setOpen(true);
  };
  const choose = (index: number) => { onValueChange(options[index].value); close(); trigger.current?.focus({ preventScroll: true }); };

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
      const gap = 6;
      const below = viewportBottom - anchor.bottom - gap;
      const above = anchor.top - viewportTop - gap;
      const side = below >= Math.min(280, options.length * 44 + 12) || below >= above ? "below" : "above";
      const available = Math.max(0, side === "below" ? below : above);
      const maxHeight = Math.min(300, available);
      // Keep the menu's actual height bounded, including variable-height labels.
      const height = Math.min(menu.current?.scrollHeight ?? 300, maxHeight);
      setPlacement({ side, style: {
        left: anchor.left - box.left,
        top: (side === "below" ? anchor.bottom + gap : anchor.top - gap - height) - box.top,
        width: anchor.width, maxHeight,
        visibility: anchor.bottom < viewportTop || anchor.top > viewportBottom ? "hidden" : "visible",
      } });
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(trigger.current); observer.observe(host);
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
      observer.disconnect(); window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [open, host, options.length, close]);

  useEffect(() => {
    if (!open) return;
    const item = menu.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (item && menu.current) {
      const list = menu.current;
      if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
      else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }, [active, open]);

  return <>
    <button ref={trigger} type="button" id={id} role="combobox" className="fp-input fp-combobox" disabled={disabled}
      aria-labelledby={`${labelId} ${id}-value`} aria-controls={open ? `${id}-list` : undefined}
      aria-haspopup="listbox" aria-expanded={open} aria-required={required} aria-invalid={invalid || undefined}
      aria-describedby={describedBy} aria-activedescendant={open ? `${id}-option-${active}` : undefined}
      onClick={() => open ? close() : show()}
      onBlur={() => { if (!pressingMenu.current) close(); }}
      onKeyDown={event => {
        const key = event.key;
        if (key === "Tab") { close(); return; }
        if (key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(key)) {
          event.preventDefault(); event.stopPropagation();
          if (!open) { show(key === "ArrowUp" || key === "End"); return; }
          if (key === "Enter" || key === " ") { choose(active); return; }
          setActive(index => key === "Home" ? 0 : key === "End" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (key === "ArrowDown" ? 1 : -1))));
        } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          const now = Date.now();
          typeahead.current.value = now - typeahead.current.time > 700 ? key : typeahead.current.value + key;
          typeahead.current.time = now;
          const query = typeahead.current.value.toLocaleLowerCase();
          const match = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(query));
          if (!open) show();
          if (match >= 0) setActive(match);
        }
      }}>
      {icon && <span className="fp-combobox-icon" aria-hidden="true">{icon}</span>}
      <span id={`${id}-value`} className={selected < 0 ? "fp-combobox-value fp-placeholder" : "fp-combobox-value"}>{options[selected]?.label ?? placeholder}</span>
      <ChevronDown size={17} className="fp-combobox-chevron" data-open={open} aria-hidden="true" />
    </button>
    {mounted && host && createPortal(<div ref={menu} id={`${id}-list`} role="listbox" aria-labelledby={labelId}
      aria-hidden={!open || undefined} className="fp-listbox" data-open={open} data-side={placement?.side}
      style={placement?.style ?? { visibility: "hidden" }}
      onPointerDown={event => {
        // Mouse/pen: keep focus on the trigger. Touch: leave the default so the
        // list still scrolls, and let the blur guard keep it open.
        if (event.pointerType !== "touch") { event.preventDefault(); return; }
        pressingMenu.current = true;
        const release = () => { window.setTimeout(() => { pressingMenu.current = false; }, 0); };
        window.addEventListener("pointerup", release, { once: true, capture: true });
        window.addEventListener("pointercancel", release, { once: true, capture: true });
      }}>
      {options.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={value === option.value}
        className="fp-option" data-index={index} data-active={active === index}
        onPointerMove={event => { if (event.pointerType === "mouse") setActive(index); }}
        onClick={() => choose(index)}>
        <span>{option.label}</span><Check size={15} className={value === option.value ? "" : "invisible"} aria-hidden="true" />
      </div>)}
    </div>, host)}
  </>;
}
