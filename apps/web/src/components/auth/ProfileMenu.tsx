"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Briefcase, LogOut, Settings, Star, User as UserIcon } from "lucide-react";
import { useSession } from "@/components/auth/SessionProvider";
import { clearOfflineData } from "@/lib/offline";

// ---------------------------------------------------------------------------
// The top-right avatar, and the menu behind it.
//
// It is bound to the EXISTING FurlPay session — the `furlpay_session` JWT
// minted by the passkey / OTP / Google / Apple routes and read by
// /api/auth/session. Nothing here mints a token, stores a password, or keeps a
// user record of its own; sign-in navigates to the app's own /login and sign-out
// posts to the app's own /api/auth/logout, which revokes the jti server-side.
//
// The five states are distinct on purpose (see SessionProvider):
//
//   loading    a skeleton disc — not a signed-out icon that then swaps, which
//              makes the header flicker on every navigation
//   anonymous  a silhouette, opening a short "here is what an account gets you"
//              popover instead of yanking the reader off the page
//   expired    the same silhouette, but the popover says the session ended,
//              because silently demoting a signed-in user to a stranger is the
//              single most confusing thing an auth surface can do
//   error      also a silhouette, but the menu does NOT claim they are signed
//              out — the request failed, and it says so
//   active     their photo or initials, opening the account menu
// ---------------------------------------------------------------------------

export default function ProfileMenu({ className }: { className?: string }) {
  const { status, user, refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const menuId = useId();

  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  // Dismissal: a pointer anywhere outside, or Escape from anywhere. Both are
  // registered on the document so the menu closes even when the click lands on
  // another popover's trigger — two open menus at once is a broken header.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // Move focus into the panel when it opens, so a keyboard user is not left
  // tabbing through the whole page to reach a menu they just opened.
  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>(
      "a[href], button:not([disabled])"
    );
    first?.focus();
  }, [open]);

  // Arrow-key navigation within the panel.
  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? []
    );
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  async function signOut() {
    setSigningOut(true);
    try {
      // Wipe the offline mirror with the session — the same order /profile
      // uses. Leaving cached account data behind after a sign-out would let the
      // next person on the device read it from IndexedDB.
      await clearOfflineData();
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setSigningOut(false);
      close(false);
      await refresh();
      // Stay put. /markets is public, so signing out here should return the
      // reader to the page they were on, not eject them to a login screen.
      router.refresh();
    }
  }

  const signInHref = `/login?next=${encodeURIComponent(pathname || "/markets")}`;
  const loading = status === "loading" || status === "idle";
  const authed = status === "authenticated" && user;

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={authed ? `Open profile menu for ${user.name}` : "Open profile menu"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="tap flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white/[0.05] transition-colors hover:bg-white/[0.1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
      >
        <Avatar loading={loading} name={user?.name} initials={user?.initials} avatarUrl={user?.avatarUrl} />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label="Profile"
          onKeyDown={onPanelKeyDown}
          // Right-anchored on desktop; on a narrow viewport it becomes a
          // near-full-width sheet pinned to the right edge so it cannot run off
          // the screen the way a fixed 260px panel would.
          className="app-pop app-pop-in absolute right-0 top-[calc(100%+8px)] z-50 w-[min(268px,calc(100vw-24px))] overflow-hidden"
        >
          {authed ? (
            <>
              <div className="flex items-center gap-3 border-b border-white/[0.07] px-3.5 py-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-white/[0.04]">
                  <Avatar name={user.name} initials={user.initials} avatarUrl={user.avatarUrl} size={40} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold text-white">{user.name}</span>
                  <span className="block truncate text-[11.5px] text-textSecondary">{user.email}</span>
                </span>
              </div>

              <div className="p-1.5">
                {[
                  { href: "/profile", label: "Profile", Icon: UserIcon },
                  { href: "/investing", label: "Portfolio", Icon: Briefcase },
                  { href: "/markets?view=watchlist", label: "Watchlist", Icon: Star },
                  { href: "/profile", label: "Settings", Icon: Settings },
                ].map(({ href, label, Icon }) => (
                  <Link
                    key={label}
                    href={href}
                    role="menuitem"
                    onClick={() => close(false)}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-textSecondary transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:bg-white/[0.06] focus-visible:text-white focus-visible:outline-none"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </Link>
                ))}
              </div>

              <div className="border-t border-white/[0.07] p-1.5">
                <button
                  type="button"
                  role="menuitem"
                  disabled={signingOut}
                  onClick={signOut}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-loss transition-colors hover:bg-loss/[0.1] focus-visible:bg-loss/[0.1] focus-visible:outline-none disabled:opacity-60"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </>
          ) : (
            <div className="p-4">
              <p className="text-[14px] font-bold text-white">
                {status === "expired" ? "Your session has expired" : "Welcome to FurlPay"}
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-textSecondary">
                {status === "expired"
                  ? "Sign in again to get back to your portfolio and watchlist."
                  : status === "error"
                    ? "We could not check your sign-in status. Check your connection and try again."
                    : "Sign in to manage your portfolio, watchlist and investments."}
              </p>

              {status === "error" ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void refresh()}
                  className="mt-3.5 w-full rounded-lg border border-white/15 py-2 text-[13px] font-semibold text-white transition-colors hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Try again
                </button>
              ) : (
                <>
                  <Link
                    href={signInHref}
                    role="menuitem"
                    onClick={() => close(false)}
                    className="mt-3.5 block w-full rounded-lg bg-accent py-2 text-center text-[13px] font-bold text-[#04202a] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {status === "expired" ? "Sign in again" : "Sign In"}
                  </Link>
                  {status !== "expired" && (
                    <p className="mt-3 text-center text-[11.5px] text-textMuted">
                      Don&apos;t have an account?{" "}
                      <Link
                        href="/signup"
                        role="menuitem"
                        onClick={() => close(false)}
                        className="font-semibold text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        Create account
                      </Link>
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The avatar image itself, in priority order: a provider-hosted photo, then
 * initials taken from the real name, then a neutral silhouette.
 *
 * No generated identicon and no placeholder initials. Two letters that stand
 * for nothing look exactly like two letters that stand for someone.
 */
function Avatar({
  loading,
  name,
  initials,
  avatarUrl,
  size = 36,
}: {
  loading?: boolean;
  name?: string | null;
  initials?: string | null;
  avatarUrl?: string | null;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);

  if (loading) {
    return (
      <span
        aria-hidden
        className="animate-pulse rounded-full bg-white/10"
        style={{ width: size - 4, height: size - 4 }}
      />
    );
  }

  if (avatarUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a remote provider
      // URL on an arbitrary host; next/image would need it in remotePatterns,
      // and the loader adds nothing for a 36px square that is already cached.
      <img
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="h-full w-full rounded-full object-cover"
      />
    );
  }

  if (initials) {
    return (
      <span
        aria-hidden
        title={name ?? undefined}
        className="grid h-full w-full place-items-center rounded-full bg-gradient-to-br from-accent/30 to-accent/30 text-[11.5px] font-bold text-white"
      >
        {initials}
      </span>
    );
  }

  return <UserIcon className="h-[18px] w-[18px] text-textSecondary" aria-hidden />;
}
