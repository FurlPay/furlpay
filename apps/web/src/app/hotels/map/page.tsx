import type { Metadata } from "next";
import Link from "next/link";
import HotelMap from "@/components/travel/HotelMap";

export const metadata: Metadata = {
  title: "Hotel map",
  // Not "with nightly rates". There are none: the indexed dataset holds no
  // prices and production has no live rate provider, so the old description
  // promised a search engine something the page cannot show.
  description:
    "Browse 16,000 hotels, resorts and villas worldwide on a live map, with ratings and photographs from Google Places.",
};

// Full-bleed map, no chrome — no sidebar, no page header, no avatar. The map's
// own floating search bar is the only interface over it, which is the pattern
// every serious map product uses: furniture around a map costs the map the one
// thing it needs, which is area.
//
// The route opts out of the 440px phone column in lib/shellRoutes.ts for the
// same reason the ticker pages do: a world map in a phone-width column is not
// a map.
/**
 * `?all=1` turns on the global lodging registry overlay.
 *
 * A URL parameter rather than a stored preference, deliberately: it is
 * shareable and debuggable ("open this link and you'll see what I see"), and
 * it cannot strand someone in a mode they don't remember enabling. The
 * registry is empty until scripts/ingest-hotel-seeds.mts has run, so the
 * default stays off — an empty overlay looks like a broken map.
 */
export default async function HotelMapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const showRegistryTiles = params.all === "1";

  return (
    <div className="h-[100dvh] w-full">
      {/* The map is WebGL and client-rendered, so a crawler that does not run
          JS — and Googlebot, which runs it but never drags or zooms — sees an
          empty canvas and nothing to index. This gives both a real route into
          the same inventory rather than a dead end. It is also the honest
          fallback for a reader with JS disabled or no GPU. */}
      <noscript>
        <div className="mx-auto max-w-xl px-6 py-16 text-center">
          <h1 className="text-xl font-semibold text-white">Hotel map</h1>
          <p className="mt-2 text-sm text-textSecondary">
            The interactive map needs JavaScript and WebGL. The same properties are
            browsable by city.
          </p>
          <Link href="/hotels" className="mt-4 inline-block text-neon hover:underline">
            Browse hotels by city
          </Link>
        </div>
      </noscript>
      <HotelMap showRegistryTiles={showRegistryTiles} />
    </div>
  );
}
