import type { Metadata } from "next";
import ComparePage from "@/components/marketing/ComparePage";

export const metadata: Metadata = {
  title: "Furlpay vs GetYourGuide — Creator Payouts & Crypto Pay (2026)",
  description:
    "Furlpay vs GetYourGuide for travel creators: GetYourGuide's affiliate baseline is ~8% paid in fiat monthly. Furlpay's creator program pays up to 10% in USDC weekly with no minimum, 2% follower cashback, and on-chain attribution.",
  alternates: { canonical: "/compare/getyourguide" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/compare/getyourguide",
    siteName: "Furlpay",
    title: "Furlpay vs GetYourGuide — Creator Payouts & Crypto Pay (2026)",
    description: "Furlpay vs GetYourGuide for travel creators: GetYourGuide's affiliate baseline is ~8% paid in fiat monthly. Furlpay's creator program pays up to 10% in USDC weekly with no minimum, 2% follower cashback, and on-chain attribution.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Furlpay vs GetYourGuide — Creator Payouts & Crypto Pay (2026)",
    description: "Furlpay vs GetYourGuide for travel creators: GetYourGuide's affiliate baseline is ~8% paid in fiat monthly. Furlpay's creator program pays up to 10% in USDC weekly with no minimum, 2% follower cashback, and on-chain attribution.",
    images: ["/og.png"],
  },
};

export default function Page() {
  return (
    <ComparePage
      competitor="GetYourGuide"
      slug="getyourguide"
      title="Furlpay vs GetYourGuide"
      subtitle="GetYourGuide is a leading tours-and-activities marketplace with an affiliate program. Furlpay is a stablecoin travel platform whose creator program pays up to 10% in USDC weekly, with on-chain attribution and 2% cashback for followers."
      atomicAnswer={
        <>
          <strong className="text-white">GetYourGuide</strong> pays affiliates a baseline near 8% in fiat,
          typically monthly, on a ~30-day cookie. <strong className="text-white">Furlpay</strong>&apos;s creator
          program pays up to 10% in USDC on a weekly cycle with no minimum payout, a 90-day cookie window, 2%
          USDC cashback for followers, and on-chain attribution you can verify — built for creators who want
          fast, global, dollar-stable earnings.
        </>
      }
      rows={[
        { feature: "Top commission", furlpay: "Up to 10% (flat gross)", other: "~8% baseline (of GYG's cut)", furlpayWins: true },
        { feature: "Payout currency", furlpay: "USDC to any wallet", other: "Fiat, bank only", furlpayWins: true },
        { feature: "Payout speed", furlpay: "Weekly", other: "Monthly on confirmation", furlpayWins: true },
        { feature: "Minimum payout", furlpay: "None", other: "Threshold applies", furlpayWins: true },
        { feature: "Cookie window", furlpay: "90 days", other: "~30 days", furlpayWins: true },
        { feature: "Follower reward", furlpay: "2% USDC cashback", other: "None", furlpayWins: true },
        { feature: "Attribution", furlpay: "On-chain, verifiable", other: "Dashboard only", furlpayWins: true },
      ]}
      analysis={[
        { title: "Weekly USDC vs monthly fiat", body: "GetYourGuide pays affiliates in fiat, typically monthly and after the activity is confirmed. Furlpay settles creator commission in USDC weekly, the moment a booking clears — better cash flow and no bank minimums, from the first booking, anywhere in the world." },
        { title: "A flat gross rate, not a split", body: "Most marketplaces pay a slice of their own cut. Furlpay pays a flat gross commission on the booking value, up to 10%, so a creator's effective rate is among the highest in travel." },
        { title: "On-chain attribution", body: "Furlpay records bookings and payouts on-chain, so a creator can verify earnings and attribution independently instead of trusting a black-box dashboard — a real answer to disputed or dropped attribution." },
        { title: "Followers earn too", body: "Every traveler who books through a creator's link can receive up to 2% cashback in USDC, strengthening the creator's relationship with their audience rather than rewarding only the platform." },
      ]}
      faq={[
        { q: "Is Furlpay a good GetYourGuide affiliate alternative?", a: "Yes, especially for creators who want faster, global, dollar-stable earnings. Furlpay pays up to 10% in USDC weekly with no minimum payout, a 90-day cookie, 2% follower cashback, and on-chain attribution — versus GetYourGuide's ~8% fiat baseline paid monthly." },
        { q: "How much does the Furlpay creator program pay?", a: "Creators start at 6% and rise to 8% (Voyager) and up to 10% (Pioneer) as their volume grows, paid in USDC weekly with no minimum payout. Followers also earn up to 2% USDC cashback." },
        { q: "How is attribution tracked?", a: "Bookings and payouts are recorded on-chain, so earnings and attribution are independently verifiable rather than shown only in a dashboard, with a 90-day cookie window to capture delayed bookings." },
      ]}
    />
  );
}
