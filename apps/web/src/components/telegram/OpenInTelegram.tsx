import Link from "next/link";
import { ArrowUpRight, Send } from "lucide-react";
import { telegramLaunchUrl } from "@/lib/telegram-mini-app/config";

// "Open in Telegram" on the website. The t.me link is built from the public bot
// username (NEXT_PUBLIC_TELEGRAM_BOT_USERNAME) and carries only a routing hint
// (startapp=discover) — never a session, token or account detail. Until the
// bot's Main Mini App is configured the link is not shown at all; the browser
// preview at /telegram always works, so Telegram is never required.
export default function OpenInTelegram({ start = "discover" }: { start?: string }) {
  const launch = telegramLaunchUrl(start);
  return (
    <div className="mt-5 flex flex-col items-center gap-1.5">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {launch && (
          <a
            href={launch}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#2AABEE]/40 bg-[#2AABEE]/10 px-4 text-[14px] font-semibold text-[#7cc8f5] transition-colors hover:border-[#2AABEE]/70 hover:bg-[#2AABEE]/15"
          >
            <Send size={15} aria-hidden /> Open in Telegram <ArrowUpRight size={14} aria-hidden />
          </a>
        )}
        <Link href="/telegram" className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[14px] text-textSecondary transition-colors hover:text-white">
          {launch ? "Preview in browser" : "Preview the Telegram mini app"} <ArrowUpRight size={14} aria-hidden />
        </Link>
      </div>
      {launch && <p className="text-[12px] text-textSecondary">Access FurlPay directly inside Telegram.</p>}
    </div>
  );
}
