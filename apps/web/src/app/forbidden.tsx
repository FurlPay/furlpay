import Link from "next/link";
import { ShieldAlert } from "lucide-react";

// Rendered with HTTP 403 whenever a server component calls forbidden()
// (next.config.js experimental.authInterrupts). Today that is the admin gate
// on /analytics. Says nothing about what the page contains.
export default function Forbidden() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070A09] px-6 text-white">
      <div className="max-w-md rounded-2xl border border-white/[0.08] bg-[#0B100E] p-8 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-neon" aria-hidden />
        <h1 className="mt-4 text-[22px] font-semibold">Admin access required</h1>
        <p className="mt-2 text-[14px] text-textSecondary">
          This area is an internal FurlPay operations tool. Your account does not have access to it.
        </p>
        <p className="mt-4 text-[14px] text-[#C9CDCB]">
          Looking for your own spending breakdown?{" "}
          <Link href="/spending" className="text-neon underline-offset-2 hover:underline">
            Open spending insights
          </Link>
        </p>
      </div>
    </main>
  );
}
