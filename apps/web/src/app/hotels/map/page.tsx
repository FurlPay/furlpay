import type { Metadata } from "next";
import HotelMap from "@/components/travel/HotelMap";

export const metadata: Metadata = {
  title: "Hotel map",
  description: "Browse hotels worldwide on a live map with nightly rates.",
};

// Full-bleed map, no chrome — no sidebar, no page header, no avatar. The map's
// own floating search bar is the only interface over it, which is the pattern
// every serious map product uses: furniture around a map costs the map the one
// thing it needs, which is area.
//
// The route opts out of the 440px phone column in lib/shellRoutes.ts for the
// same reason the ticker pages do: a world map in a phone-width column is not
// a map.
export default function HotelMapPage() {
  return (
    <div className="h-[100dvh] w-full">
      <HotelMap />
    </div>
  );
}
