"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleCheck,
  Download,
  Lock,
  Shield,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import { useDiscoveredWallets } from "@/lib/wallet/mipd";
import {
  chainName,
  connect as connectWallet,
  isSupportedChain,
  listWallets,
  shortAddress,
  switchNetwork,
  WalletConnectError,
  type Connection,
  type ListedWallet,
} from "@/lib/wallet/connect";
import DepositFlow from "./DepositFlow";

// ---------------------------------------------------------------------------
// Connect your wallet.
//
// The flow is a state machine, not a pile of booleans: `select → connecting →
// connected → deposit`, with `error` carrying the kind so each failure gets its
// own calm, specific screen. A boolean-per-state version of this is how a modal
// ends up rendering "Connecting…" over a success screen.
//
// It connects for REAL through lib/wallet/connect.ts, which sits on the app's
// existing EIP-6963 store. Consequences worth stating plainly, because they are
// the difference between this and a mockup:
//
//   * a wallet that is not installed is shown as not installed, with an install
//     link — it does not spin and then claim success;
//   * "Connecting…" stays on screen until the wallet actually answers, and a
//     rejection in MetaMask surfaces as "Connection cancelled";
//   * the address shown is the address the wallet returned;
//   * WalletConnect is listed as unavailable, because the SDK and project id
//     this deployment would need are not configured. It is not a dead button.
//
// Modal discipline matches ConfirmDialog and AssetDrawer: focus moves in and
// returns, Tab is trapped, Escape closes, the page behind cannot scroll, and it
// renders through a portal so the sticky header cannot clip it.
// ---------------------------------------------------------------------------

type Phase = "select" | "connecting" | "connected" | "deposit";

interface ErrorState {
  kind: WalletConnectError["kind"];
  message: string;
  wallet: ListedWallet | null;
}

export default function WalletConnectModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const discovered = useDiscoveredWallets();
  const wallets = useMemo(() => listWallets(discovered), [discovered]);

  const [phase, setPhase] = useState<Phase>("select");
  const [pending, setPending] = useState<ListedWallet | null>(null);
  const [conn, setConn] = useState<Connection | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [switching, setSwitching] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  // Reset when the modal is dismissed, so reopening starts at the wallet list
  // rather than on a stale success screen from last time.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setPhase("select");
      setPending(null);
      setConn(null);
      setError(null);
    }, 200);
    return () => clearTimeout(t);
  }, [open]);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button:not([disabled]), a[href]")?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])"
        ) ?? []
      ).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prev;
      returnFocusTo.current?.focus?.();
    };
  }, [open, close]);

  async function begin(wallet: ListedWallet) {
    setPending(wallet);
    setError(null);
    setPhase("connecting");
    try {
      const c = await connectWallet(wallet);
      if (c.chainId !== -1 && !isSupportedChain(c.chainId)) {
        setConn(c);
        setError({
          kind: "wrong-network",
          message: `This wallet is on ${chainName(c.chainId)}. Switch to Ethereum to continue.`,
          wallet,
        });
        setPhase("select");
        return;
      }
      setConn(c);
      setPhase("connected");
    } catch (e) {
      const err = e instanceof WalletConnectError ? e : null;
      setError({
        kind: err?.kind ?? "unknown",
        message: err?.message ?? "Something went wrong while connecting your wallet.",
        wallet,
      });
      setPhase("select");
    }
  }

  async function doSwitch() {
    if (!conn) return;
    setSwitching(true);
    try {
      await switchNetwork(conn, 1);
      setConn({ ...conn, chainId: 1 });
      setError(null);
      setPhase("connected");
    } catch (e) {
      setError({
        kind: "unknown",
        message: e instanceof Error ? e.message : "Could not switch network.",
        wallet: pending,
      });
    } finally {
      setSwitching(false);
    }
  }

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-0 backdrop-blur-[3px] sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="wallet-modal-in max-h-[92vh] w-full max-w-[540px] overflow-y-auto rounded-t-3xl border border-white/[0.09] bg-[#0A0B0C] shadow-[0_0_0_1px_rgba(52,199,89,0.06),0_30px_80px_-20px_rgba(0,0,0,0.9)] sm:max-w-[540px] sm:rounded-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {/* Header */}
        <div className="relative px-6 pt-6 text-center">
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg text-textSecondary transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
          <h2 id={titleId} className="text-[19px] font-bold tracking-tight text-white">
            {phase === "deposit" ? "Deposit assets" : "Connect your wallet"}
          </h2>
          <p id={descId} className="mt-1 text-[12.5px] text-textSecondary">
            {phase === "deposit"
              ? "Move funds from your wallet into FurlPay."
              : "Secure. Seamless. Fully protected."}
          </p>
        </div>

        {phase === "select" && (
          <>
            <SecurityHighlights />
            {error && <ConnectionError error={error} onRetry={begin} onSwitch={doSwitch} switching={switching} />}
            <WalletGrid wallets={wallets} onPick={begin} />
            <SecurityNotice />
          </>
        )}

        {phase === "connecting" && pending && (
          <ConnectingState wallet={pending} onCancel={() => setPhase("select")} />
        )}

        {phase === "connected" && conn && (
          <ConnectedWallet conn={conn} onContinue={() => setPhase("deposit")} />
        )}

        {phase === "deposit" && conn && (
          <DepositFlow conn={conn} onCancel={close} onBack={() => setPhase("connected")} />
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Trust row ──────────────────────────────────────────────────────────────

const HIGHLIGHTS = [
  {
    Icon: Shield,
    title: "Your keys stay yours",
    body: "FurlPay never receives your recovery phrase or private keys.",
  },
  {
    Icon: Lock,
    title: "You're in control",
    body: "Connecting shares your address. It does not authorise any payment.",
  },
  {
    Icon: CircleCheck,
    title: "Nothing moves silently",
    body: "Every transfer needs your explicit approval in your own wallet.",
  },
];

/**
 * The three trust statements.
 *
 * Rewritten from the reference wording on purpose. "Bank-level security",
 * "industry-leading encryption" and "trusted by thousands" are claims about
 * certifications, cryptography and userbase that this application cannot
 * evidence — and on a wallet screen, an unverifiable security claim is exactly
 * the pattern users are told to distrust. These three say only things the code
 * actually guarantees.
 */
function SecurityHighlights() {
  return (
    <ul className="grid grid-cols-1 gap-3 px-6 pt-5 sm:grid-cols-3">
      {HIGHLIGHTS.map(({ Icon, title, body }) => (
        <li key={title} className="flex gap-2.5 sm:flex-col sm:items-center sm:text-center">
          <Icon className="h-[18px] w-[18px] shrink-0 text-gain" aria-hidden strokeWidth={1.75} />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-white">{title}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-textMuted">{body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Wallet grid ────────────────────────────────────────────────────────────

function WalletGrid({
  wallets,
  onPick,
}: {
  wallets: ListedWallet[];
  onPick: (w: ListedWallet) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? wallets : wallets.slice(0, 5);
  const hidden = wallets.length - visible.length;

  return (
    <div className="px-6 pt-5">
      <h3 className="text-[13px] font-semibold text-white">Choose your wallet</h3>
      <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map((w) => (
          <WalletCard key={w.rdns} wallet={w} onPick={onPick} />
        ))}

        {!showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-gain/40 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.06]">
              <WalletIcon className="h-4 w-4 text-textSecondary" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold text-white">More wallets</span>
              <span className="block truncate text-[11px] text-textMuted">
                {hidden > 0 ? `${hidden} more detected` : "Any EIP-6963 wallet"}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-textMuted" aria-hidden />
          </button>
        )}
      </div>

      {/* Said once, plainly, instead of implying every listed wallet works. */}
      <p className="mt-2.5 text-[10.5px] leading-relaxed text-textMuted">
        Wallets you have installed are listed first. FurlPay detects them through the browser&apos;s
        wallet-discovery standard, so this list reflects what is actually on this device.
      </p>
    </div>
  );
}

function WalletCard({ wallet, onPick }: { wallet: ListedWallet; onPick: (w: ListedWallet) => void }) {
  const disabled = wallet.requiresInfrastructure;
  const label = disabled ? "Unavailable" : wallet.installed ? "Connect" : "Not installed";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(wallet)}
      aria-label={`${wallet.name} — ${label}`}
      className="group flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-left transition-all hover:border-gain/40 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-white/[0.08] disabled:hover:bg-white/[0.02]"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/[0.06]">
        {wallet.icon ? (
          // eslint-disable-next-line @next/next/no-img-element -- an EIP-6963
          // data: URI announced by the wallet itself; next/image cannot process
          // it and it is already inline.
          <img src={wallet.icon} alt="" width={20} height={20} className="h-5 w-5 object-contain" />
        ) : (
          <WalletIcon className="h-4 w-4 text-textSecondary" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold text-white">{wallet.name}</span>
        <span
          className={`block truncate text-[11px] ${
            wallet.installed && !disabled ? "text-gain" : "text-textMuted"
          }`}
        >
          {label}
        </span>
      </span>
    </button>
  );
}

// ── Connecting ─────────────────────────────────────────────────────────────

function ConnectingState({ wallet, onCancel }: { wallet: ListedWallet; onCancel: () => void }) {
  return (
    <div className="px-6 py-10 text-center" role="status" aria-live="polite">
      <span className="relative mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.05]">
        {wallet.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={wallet.icon} alt="" width={28} height={28} className="h-7 w-7 object-contain" />
        ) : (
          <WalletIcon className="h-6 w-6 text-textSecondary" aria-hidden />
        )}
        <span
          aria-hidden
          className="absolute inset-0 animate-spin rounded-2xl border-2 border-transparent border-t-gain"
        />
      </span>

      <p className="mt-4 text-[15px] font-bold text-white">Connecting to {wallet.name}…</p>
      <p className="mx-auto mt-1.5 max-w-[300px] text-[12.5px] leading-relaxed text-textSecondary">
        Confirm the connection in your wallet. FurlPay is asking for your address only.
      </p>

      <button
        type="button"
        onClick={onCancel}
        className="mt-5 rounded-lg border border-white/[0.14] px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
      >
        Cancel
      </button>
    </div>
  );
}

// ── Connected ──────────────────────────────────────────────────────────────

function ConnectedWallet({ conn, onContinue }: { conn: Connection; onContinue: () => void }) {
  return (
    <div className="px-6 py-8 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gain/[0.12]">
        <Check className="h-7 w-7 text-gain" aria-hidden strokeWidth={2.5} />
      </span>
      <p className="mt-4 text-[15px] font-bold text-white">Wallet connected</p>
      <p className="mt-2 inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 font-mono text-[12.5px] text-white">
        {shortAddress(conn.address)}
      </p>
      <p className="mt-2 text-[11.5px] text-textMuted">
        {conn.name} · {conn.chainId === -1 ? "network unknown" : chainName(conn.chainId)}
      </p>

      <button
        type="button"
        onClick={onContinue}
        className="mt-5 w-full rounded-xl bg-gain py-3 text-[13.5px] font-bold text-[#04220F] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
      >
        Continue to deposit
      </button>
      <p className="mt-3 text-[10.5px] leading-relaxed text-textMuted">
        To revoke access later, disconnect FurlPay from inside {conn.name}. A website cannot remove
        its own permission.
      </p>
    </div>
  );
}

// ── Errors ─────────────────────────────────────────────────────────────────

function ConnectionError({
  error,
  onRetry,
  onSwitch,
  switching,
}: {
  error: ErrorState;
  onRetry: (w: ListedWallet) => void;
  onSwitch: () => void;
  switching: boolean;
}) {
  const titles: Record<string, string> = {
    rejected: "Connection cancelled",
    "not-detected": "Wallet not detected",
    "wrong-network": "Wrong network",
    timeout: "Connection timed out",
    unavailable: "Not available yet",
    unknown: "Could not connect",
  };

  return (
    <div role="alert" className="mx-6 mt-4 rounded-xl border border-white/[0.09] bg-white/[0.03] p-3.5">
      <p className="text-[12.5px] font-semibold text-white">{titles[error.kind] ?? titles.unknown}</p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-textSecondary">{error.message}</p>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {error.kind === "not-detected" && error.wallet?.installUrl && (
          <a
            href={error.wallet.installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-gain px-3 py-1.5 text-[11.5px] font-bold text-[#04220F] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
          >
            <Download className="h-3 w-3" aria-hidden />
            Install {error.wallet.name}
          </a>
        )}
        {error.kind === "wrong-network" && (
          <button
            type="button"
            onClick={onSwitch}
            disabled={switching}
            className="rounded-lg bg-gain px-3 py-1.5 text-[11.5px] font-bold text-[#04220F] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain disabled:opacity-50"
          >
            {switching ? "Switching…" : "Switch to Ethereum"}
          </button>
        )}
        {(error.kind === "rejected" || error.kind === "timeout" || error.kind === "unknown") &&
          error.wallet && (
            <button
              type="button"
              onClick={() => onRetry(error.wallet!)}
              className="rounded-lg border border-white/[0.14] px-3 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
            >
              Try again
            </button>
          )}
      </div>
    </div>
  );
}

// ── Footer ─────────────────────────────────────────────────────────────────

function SecurityNotice() {
  return (
    <div className="m-6 mt-5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <p className="flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white">
        <Shield className="h-3.5 w-3.5 text-gain" aria-hidden strokeWidth={2} />
        Security is our top priority
      </p>
      <p className="mt-1.5 text-center text-[11px] leading-relaxed text-textSecondary">
        FurlPay never stores your private keys and cannot move funds from your wallet. Connecting
        shares your public address; every transfer is signed by you.
      </p>
      <a
        href="/trust"
        className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border-t border-white/[0.06] pt-3 text-[11.5px] font-semibold text-textSecondary transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
      >
        Learn more about our security practices
        <ArrowUpRight className="h-3 w-3" aria-hidden />
      </a>
    </div>
  );
}
