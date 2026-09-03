import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { ROLE_ICONS } from "@/lib/discordRoles/iconData";
import { ROLE_CATALOG } from "@/lib/discordRoles/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/og/role-icon/[key] — one role's icon as a PNG.
//
// ── WHY A PNG AND NOT THE SVG ──────────────────────────────────────────────
//
// Discord custom emoji accept PNG, GIF and WEBP. They do NOT accept SVG, and
// there is no way to put an inline image in embed text or a select option —
// the only mechanism for a non-unicode icon in either place is a custom guild
// emoji. So the vector has to become a raster somewhere, and doing it here
// means the source of truth stays the Lucide geometry rather than a binary
// checked into the repo.
//
// 128x128 is Discord's own recommendation for emoji uploads; larger is
// downscaled by them, smaller looks soft on high-density displays.
//
// ── WHY THE PADDING AND THE COLOUR ─────────────────────────────────────────
//
// Emoji render at roughly 22px inline. A 24-unit glyph scaled straight to the
// full 128 square touches every edge and reads as a smudge at that size, so the
// icon is inset and the stroke thickened. The colour is fixed rather than the
// role's own: emoji sit on both light and dark Discord themes, and a mid-tone
// that works on both beats a brand colour that vanishes on one.
export async function GET(req: NextRequest, props: { params: Promise<{ key: string }> }) {
  const limited = await rateLimitOr429(req, "og.roleIcon", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const { key } = await props.params;
  const spec = ROLE_ICONS[key];

  if (!spec) {
    return new Response("Unknown role icon", { status: 404 });
  }

  // The role's accent, when it has one, at a lightness that survives both
  // Discord themes. Falls back to the brand green.
  const role = ROLE_CATALOG.find((r) => r.key === key);
  const stroke = role?.color ? `#${role.color.toString(16).padStart(6, "0")}` : "#00E599";

  const SIZE = 128;
  const PAD = 14;
  const inner = SIZE - PAD * 2;

  return new ImageResponse(
    (
      <div
        style={{
          width: SIZE,
          height: SIZE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Transparent: Discord composites emoji over whatever the theme is.
          background: "transparent",
        }}
      >
        <svg
          width={inner}
          height={inner}
          viewBox="0 0 24 24"
          fill="none"
          stroke={stroke}
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {spec.elements.map((el, i) => {
            const Tag = el.tag as "path" | "circle" | "rect" | "line" | "polyline" | "polygon" | "ellipse";
            return <Tag key={i} {...el.attrs} />;
          })}
        </svg>
      </div>
    ),
    {
      width: SIZE,
      height: SIZE,
      headers: {
        // Icons are static per key; let Discord and the CDN keep them.
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    }
  );
}
