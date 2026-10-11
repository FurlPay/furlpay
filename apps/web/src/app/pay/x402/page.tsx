import type { Metadata } from "next";
import X402Checkout from "./X402Checkout";

export const metadata: Metadata = { title: "Pay with FurlPay · x402", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") qs.set(k, v);
  return <X402Checkout search={qs.toString()} />;
}
