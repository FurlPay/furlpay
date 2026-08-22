import type { Metadata } from "next";
import TripsShowcase from "@/components/trips/TripsShowcase";
import { DEMO_TRIP } from "@/lib/trips/demoTrip";

export const metadata: Metadata = {
  title: "FurlPay Trips — Your journey, live on your iPhone",
  description:
    "Book with USDC and your boarding pass, gate, seat and live flight status stay on your Lock Screen. FurlPay Trips turns every booking into a Live Activity.",
  alternates: { canonical: "/trips" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/trips",
    siteName: "Furlpay",
    title: "FurlPay Trips — Your journey, live on your iPhone",
    description:
      "Boarding pass, gate, seat and live flight status on your Lock Screen — paid in USDC with 2% back.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FurlPay Trips — Your journey, live on your iPhone",
    description: "Live flight status and your boarding pass, in the wallet that paid for the trip.",
    images: ["/og.png"],
  },
};

export default function TripsPage() {
  return <TripsShowcase trip={DEMO_TRIP} />;
}
