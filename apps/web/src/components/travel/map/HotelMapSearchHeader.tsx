"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PropertyFamily } from "@/lib/hotels/curated";
import VoiceInputButton from "@/components/VoiceInputButton";
import { ClockIcon, CloseIcon, HotelIcon, PinIcon, SearchIcon } from "./icons";

// ---------------------------------------------------------------------------
// The floating search header.
//
// Sits ABOVE the map rather than being docked into it — margin on all sides, so
// the cartography runs underneath and the header reads as a control surface
// resting on the map rather than a toolbar bolted to the top of the page.
//
// THE SUGGESTIONS ARE REAL. Every destination offered is a place the curated
// dataset actually holds properties in, with the real count beside it, and
// picking one flies the map there. A hardcoded list of glamorous cities would
// look identical right up to the moment somebody picked one the dataset has
// nothing in, and then the map would fly somewhere empty.
//
// ── SURFACE ────────────────────────────────────────────────────────────────
// Dark charcoal, and DELIBERATELY UNACCENTED. Nothing in this component draws a
// coloured border, ring or glow. The header's whole job is to be the quietest
// possible frame around the map, so state is carried by surface lightness —
// white at 6%, 8%, 12% — rather than by hue. An accent line around the outside
// of a control this large stops being an accent and becomes the loudest element
// on the page, which is the failure this layout is correcting.
//
// ── NO SCROLLING STRIP ─────────────────────────────────────────────────────
// The filter row is `flex-wrap`. That is the entire mechanism preventing a
// horizontal scrollbar: at any width the controls cannot exceed the container,
// they reflow onto a second line instead. There is no `overflow-x` anywhere in
// this file, and none should be added — a strip that scrolls sideways hides
// controls behind a gesture most people never make.
// ---------------------------------------------------------------------------

/** The bar and the dropdown share one ground: white, and translucent enough
 *  that the map reads through it without the text on top losing contrast. The
 *  blur is what makes that legible — over an unblurred map, coastlines and
 *  labels show through the panel and fight the words sitting on it. */
const BAR = "rgba(255,255,255,0.82)";
/** The inset well the input sits in. On a white ground "inset" is a step
 *  DARKER, not lighter — the dark build had this the other way round. */
const WELL = "rgba(15,23,42,0.045)";
/** The keyboard-shortcut badge. */
const KBD = "rgba(15,23,42,0.06)";

export interface Destination {
  /** What the user sees and what gets searched. */
  label: string;
  sublabel: string;
  latitude: number;
  longitude: number;
  count: number;
  kind: "destination" | "property";
}

export default function HotelMapSearchHeader({
  query,
  onQuery,
  suggestions,
  onPick,
  families,
  minStars,
  filtersOpen,
  onToggleFilters,
  moreFilterCount,
  recent,
  onClearRecent,
}: {
  query: string;
  onQuery: (s: string) => void;
  suggestions: Destination[];
  onPick: (d: Destination) => void;
  /** Read only — to label the Property type button. Toggling lives in the panel. */
  families: PropertyFamily[];
  /** Read only — to label the Rating button. */
  minStars: number;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  /** Active filters the two named buttons do NOT already account for. */
  moreFilterCount: number;
  /** Previously chosen destinations, newest first. Owned by the map so that
   *  picking a row is recorded in one place — see lib/hotels/recentSearches. */
  recent: Destination[];
  onClearRecent: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // The shortcut label resolves AFTER mount, and renders as nothing until it
  // does. The server has no way to know which platform is asking, so painting a
  // guess would either be wrong for half of readers or — worse — differ between
  // the server and client markup and trip a hydration mismatch.
  const [shortcut, setShortcut] = useState<string | null>(null);
  useEffect(() => {
    const ua = `${navigator.platform ?? ""} ${navigator.userAgent}`;
    setShortcut(/Mac|iPhone|iPad|iPod/.test(ua) ? "⌘K" : "Ctrl K");
  }, []);

  // Cmd/Ctrl+K focuses the field from anywhere on the page. Both modifiers are
  // accepted whichever label is showing: a Mac user on an external PC keyboard
  // reaches for Ctrl, and refusing that would be pedantic.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close on an outside click rather than on blur: blur fires before the click
  // lands on a suggestion, which would dismiss the list before it could be
  // chosen.
  useEffect(() => {
    if (!focused) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [focused]);

  useEffect(() => setHighlight(0), [query]);

  // Recents are an EMPTY-QUERY affordance. Once there is a query the list has
  // to answer it, and history sitting above live results would push the actual
  // matches below the fold.
  const showRecent = focused && query.trim().length === 0 && recent.length > 0;

  const grouped = useMemo(
    () => ({
      destinations: suggestions.filter((s) => s.kind === "destination"),
      properties: suggestions.filter((s) => s.kind === "property"),
    }),
    [suggestions]
  );

  const open = focused && (suggestions.length > 0 || showRecent);

  // One flat array in render order, so arrow keys walk the list the eye sees
  // rather than the order the sections happen to be declared in. Highlight is
  // compared by identity — a recent is a deserialized object and can never be
  // the same reference as a suggestion, so a place present in both sections
  // still highlights the one row actually under the cursor.
  const flat = useMemo(
    () => [
      ...(showRecent ? recent : []),
      ...grouped.destinations,
      ...grouped.properties,
    ],
    [showRecent, recent, grouped]
  );
  const recentCount = showRecent ? recent.length : 0;

  const choose = (d: Destination) => {
    onPick(d);
    setFocused(false);
    input.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Escape works even when the list is already closed — the second press is
    // how you get back out of a field you did not mean to enter.
    if (e.key === "Escape") {
      setFocused(false);
      input.current?.blur();
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && flat[highlight]) {
      e.preventDefault();
      choose(flat[highlight]);
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlight(flat.length - 1);
    }
  };

  // Each named button SAYS what it is currently set to rather than just naming
  // the facet. That is what earns it a place in a header this spare: "4+ stars"
  // reports the state of the map, "Rating" only reports that a filter exists.
  const typeLabel =
    families.length === 0
      ? "Property type"
      : families.length === 1
        ? FAMILY_LABEL[families[0]]
        : `${families.length} property types`;

  // Positioning lives in HotelMap, not here. The overlays that sit BELOW this
  // bar — the zoom controls, the loading pill, the filter sheet — have to know
  // how tall it ended up, and the only way to know that without hardcoding a
  // number that a wrapped filter row would invalidate is to measure the real
  // element. So the map owns the box and this component owns its contents.
  return (
    <>
      {/* One container, not two. The filter row is separated from the search
          field by spacing rather than by a rule, which is the cheaper way to
          say "these are different things" — a divider here would reintroduce
          exactly the boxed-in look this layout is shedding. */}
      <div
        className="pointer-events-auto mx-auto flex flex-col gap-3 rounded-[15px] border border-black/[0.07] p-3 backdrop-blur-xl backdrop-saturate-150 shadow-[0_12px_32px_rgba(15,23,42,0.13),0_2px_8px_rgba(15,23,42,0.07)]"
        style={{ background: BAR }}
      >
        <div ref={wrap} className="relative min-w-0">
          {/* Focus brightens the border and nothing else. No ring, no glow, no
              hue — at this width a coloured outline reads as a container in its
              own right rather than as a state. */}
          <div
            className={`flex h-[52px] items-center gap-2.5 rounded-xl border pl-2 pr-3 transition-colors duration-200 ${
              focused ? "border-black/[0.24]" : "border-black/[0.07] hover:border-black/[0.12]"
            }`}
            style={{ background: WELL }}
          >
            {/* The icon sits in its own recessed tile — a step darker again than
                the well, so it reads as inset rather than as another button. */}
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors duration-200"
              style={{ background: "rgba(15,23,42,0.075)", color: focused ? "#0F172A" : "#475569" }}
            >
              <SearchIcon />
            </span>
            <input
              ref={input}
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onKeyDown={onKeyDown}
              placeholder="Search destinations, hotels, resorts..."
              aria-label="Search destinations, hotels and resorts"
              aria-expanded={open}
              role="combobox"
              aria-controls="hm-suggestions"
              aria-autocomplete="list"
              // Names the row the arrow keys are on, which is the only way a
              // screen reader learns that Enter is about to choose something
              // other than what was typed.
              aria-activedescendant={open && flat[highlight] ? optionId(highlight) : undefined}
              className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-[#0F172A] outline-none placeholder:text-[#64748B]"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  onQuery("");
                  input.current?.focus();
                }}
                aria-label="Clear search"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#64748B] transition-colors hover:bg-black/[0.06] hover:text-[#0F172A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-black/30"
              >
                <CloseIcon />
              </button>
            ) : (
              // Hidden from the accessibility tree: it is a visual reminder of a
              // shortcut, and a screen reader announcing "Command K" as part of
              // the field would just be noise. Hidden once focused too — the
              // shortcut has done its job by then.
              shortcut && !focused && (
                <kbd
                  aria-hidden
                  className="shrink-0 rounded-md border border-black/[0.07] px-1.5 py-0.5 font-sans text-[11px] font-semibold text-[#64748B] max-sm:hidden"
                  style={{ background: KBD }}
                >
                  {shortcut}
                </kbd>
              )
            )}

            {/* Dictation, at the right edge where the clear button and the
                shortcut hint already live.

                It fills the field rather than searching on your behalf: the
                transcript lands in the input, the suggestion list opens
                underneath it, and picking a destination stays a deliberate
                act. Speech recognition mishears place names often enough that
                flying the map straight off a transcript would send people
                somewhere they did not ask for, with no obvious way back.

                VoiceInputButton renders nothing at all where SpeechRecognition
                is missing — Firefox, and every browser with the API disabled —
                so this is additive and never leaves a dead control on screen. */}
            <VoiceInputButton
              label="Search destinations by voice"
              onResult={(transcript) => {
                onQuery(transcript);
                // Focus last: it opens the suggestion list against the text we
                // just set, so the spoken query behaves exactly like a typed one.
                input.current?.focus();
              }}
              className="text-[#64748B] hover:bg-black/[0.06] hover:text-[#0F172A]"
            />
          </div>

          {open && (
            <div
              id="hm-suggestions"
              role="listbox"
              // `no-scrollbar` (globals.css) hides the bar without disabling the
              // scroll — a native scrollbar cuts through the rounded corner and
              // the blur, and reads as a rendering fault rather than a control.
              // `overscroll-contain` stops a wheel gesture that reaches the end
              // of this list from continuing into the map and panning it.
              className="no-scrollbar absolute inset-x-0 top-[calc(100%+8px)] max-h-[420px] overflow-y-auto overscroll-contain rounded-[15px] border border-black/[0.07] py-2 backdrop-blur-xl backdrop-saturate-150 shadow-[0_12px_32px_rgba(15,23,42,0.13),0_2px_8px_rgba(15,23,42,0.07)]"
              style={{ background: BAR }}
            >
              {showRecent && (
                <Group
                  title="Recent searches"
                  action={
                    <button
                      type="button"
                      // The list closes on mousedown-outside, and a click on a
                      // button inside it lands only after that would already
                      // have dismissed it. Acting on mousedown is what keeps
                      // Clear working at all.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onClearRecent();
                      }}
                      className="rounded px-1 text-[11.5px] font-semibold text-[#475569] transition-colors hover:text-[#0F172A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-black/30"
                    >
                      Clear
                    </button>
                  }
                >
                  {recent.map((d, i) => (
                    <Suggestion
                      key={`r-${d.kind}-${d.latitude}-${d.longitude}`}
                      d={d}
                      index={i}
                      active={flat[highlight] === d}
                      onHover={() => setHighlight(i)}
                      onPick={() => choose(d)}
                      history
                    />
                  ))}
                </Group>
              )}
              {grouped.destinations.length > 0 && (
                <Group title={query ? "Destinations" : "Popular destinations"}>
                  {grouped.destinations.map((d, i) => (
                    <Suggestion
                      key={`d-${d.label}`}
                      d={d}
                      index={recentCount + i}
                      active={flat[highlight] === d}
                      onHover={() => setHighlight(recentCount + i)}
                      onPick={() => choose(d)}
                    />
                  ))}
                </Group>
              )}
              {grouped.properties.length > 0 && (
                <Group title="Properties">
                  {grouped.properties.map((d, i) => (
                    <Suggestion
                      key={`p-${d.label}`}
                      d={d}
                      index={recentCount + grouped.destinations.length + i}
                      active={flat[highlight] === d}
                      onHover={() => setHighlight(recentCount + grouped.destinations.length + i)}
                      onPick={() => choose(d)}
                    />
                  ))}
                </Group>
              )}
            </div>
          )}
        </div>

        {/* `flex-wrap`, never `overflow-x`. Three compact controls fit on one
            line at any realistic width; if they ever cannot, they wrap. */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterButton
            label={minStars ? `${minStars}+ stars` : "Rating"}
            active={minStars > 0}
            expanded={filtersOpen}
            onClick={onToggleFilters}
          />
          <FilterButton
            label={typeLabel}
            active={families.length > 0}
            expanded={filtersOpen}
            onClick={onToggleFilters}
          />
          <FilterButton
            label="More filters"
            active={moreFilterCount > 0}
            expanded={filtersOpen}
            count={moreFilterCount}
            onClick={onToggleFilters}
          />
        </div>
      </div>
    </>
  );
}

const FAMILY_LABEL: Record<PropertyFamily, string> = {
  hotels: "Hotels",
  resorts: "Resorts",
  villas: "Villas",
};

/**
 * A compact entry point into the filter sheet.
 *
 * All three open the SAME panel. That is intentional rather than lazy: the
 * panel is where every filter already lives, and giving each facet its own
 * popover would add three containers to a header whose problem was that it had
 * too many. What each button contributes is its label — it reports the current
 * setting, so the row doubles as a summary of what the map is showing.
 */
function FilterButton({
  label,
  active,
  expanded,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  expanded: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-haspopup="dialog"
      // State is surface contrast, not hue. On the white bar an active filter
      // is a slightly deeper chip with darker text; there is no coloured fill
      // or border anywhere in this row.
      className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors duration-200 ${
        active
          ? "border-black/[0.12] bg-black/[0.07] text-[#0F172A]"
          : "border-black/[0.07] bg-black/[0.03] text-[#64748B] hover:bg-black/[0.05] hover:text-[#0F172A]"
      }`}
    >
      {label}
      {/* The one inverted chip in the row: a dark pill with white numerals. On
          the white bar that is what makes a count read as a count rather than
          as more label text. */}
      {count !== undefined && count > 0 && (
        <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#0F172A] px-1 text-[10.5px] font-bold text-white">
          {count}
        </span>
      )}
    </button>
  );
}

/** Stable per-row id, so `aria-activedescendant` has something to point at. */
const optionId = (i: number) => `hm-option-${i}`;

function Group({
  title,
  action,
  children,
}: {
  title: string;
  /** Optional trailing control, right-aligned against the section label. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="px-2 py-1">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#64748B]">
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

function Suggestion({
  d, index, active, onHover, onPick, history = false,
}: {
  d: Destination;
  index: number;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
  /** Renders the clock leading icon — this row came from history, not search. */
  history?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      id={optionId(index)}
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onPick}
      // The divider is a hairline at 4% and is suppressed on the first row of
      // each group, so it separates siblings without drawing a box around them.
      className={`flex w-full items-center gap-3 rounded-lg border-t border-black/[0.05] px-3 py-3 text-left transition-colors first:border-t-0 ${
        active ? "bg-black/[0.06]" : "hover:bg-black/[0.04]"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/[0.05] ${
          history ? "text-[#64748B]" : "text-[#475569]"
        }`}
      >
        {history ? <ClockIcon /> : d.kind === "destination" ? <PinIcon /> : <HotelIcon />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-[#0F172A]">{d.label}</span>
        <span className="block truncate text-[12.5px] text-[#64748B]">{d.sublabel}</span>
      </span>
      {/* The real number of curated properties there. This is what stops the
          list being decorative — every row is somewhere the map can go. */}
      <span className="shrink-0 text-[12px] font-semibold text-[#64748B]">
        {d.count}
      </span>
    </button>
  );
}
