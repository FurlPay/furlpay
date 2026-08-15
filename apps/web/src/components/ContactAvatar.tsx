// ---------------------------------------------------------------------------
// The contact's face. Deliberately a server-safe component (no "use client")
// so a list of them costs nothing at runtime.
//
// The initials are what the user actually scans down the list for, so they are
// derived the way a person would read the name: first letter of the first word
// plus first letter of the last, with everything non-alphanumeric ignored so
// "🦊 fox" reads as "F" rather than an empty box.
// ---------------------------------------------------------------------------

const SIZES = {
  sm: { box: "h-8 w-8", text: "text-[11px]" },
  md: { box: "h-10 w-10", text: "text-[13px]" },
  lg: { box: "h-14 w-14", text: "text-[18px]" },
} as const;

export function contactInitials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = [...words[0]][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export default function ContactAvatar({
  name,
  color,
  size = "md",
  favorite = false,
}: {
  name: string;
  /** A hex from AVATAR_COLORS. Constrained server-side (see lib/contacts.ts)
   *  precisely so it is safe to interpolate into a style attribute here. */
  color: string;
  size?: keyof typeof SIZES;
  favorite?: boolean;
}) {
  const { box, text } = SIZES[size];
  return (
    <span className="relative inline-flex shrink-0">
      <span
        aria-hidden
        className={`flex items-center justify-center rounded-full font-bold text-white ${box} ${text}`}
        // A flat fill would be indistinguishable from the surface at small
        // sizes; the ring is what separates it from the row behind it.
        style={{ background: color, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" }}
      >
        {contactInitials(name)}
      </span>
      {favorite && (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-charcoal text-[8px] text-accent"
        >
          ★
        </span>
      )}
    </span>
  );
}
