import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "Status",
  description: "Furlpay system status — API, dashboard, x402 facilitator, Solana Actions, and webhooks.",
  alternates: { canonical: "/status" },
};

const SYSTEMS = [
  { name: "Web app & dashboard", state: "Operational" },
  { name: "REST API", state: "Operational" },
  { name: "x402 facilitator (verify / settle)", state: "Operational" },
  { name: "Solana Actions / Blinks", state: "Operational" },
  { name: "Webhooks delivery", state: "Operational" },
  { name: "MCP server", state: "Operational" },
  { name: "Authentication (passkeys / OTP)", state: "Operational" },
];

export default function StatusPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Status</p>
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gain opacity-70" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-gain" />
          </span>
          <h1 className="text-[32px] font-extrabold tracking-tighter sm:text-[40px]">All systems operational</h1>
        </div>

        <div className="mt-10 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10">
          {SYSTEMS.map((s) => (
            <div key={s.name} className="flex items-center justify-between px-5 py-4">
              <span className="text-[15px]">{s.name}</span>
              <span className="flex items-center gap-2 text-[13px] font-semibold text-gain">
                <span className="h-2 w-2 rounded-full bg-gain" /> {s.state}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-6 text-[12px] text-textMuted">
          Preview status board. Production wires this to real uptime monitoring (Betterstack / Vercel).
          For incidents or a security report, email{" "}
          <a href="mailto:hello@furlpay.com" className="text-neon hover:underline">hello@furlpay.com</a>.
        </p>
      </main>
    </div>
  );
}
