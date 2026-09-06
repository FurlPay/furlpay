"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseQrPayload } from "@/lib/qrPayload";
import {
  X,
  Flashlight,
  FlashlightOff,
  Copy,
  Check,
  Download,
  Share2,
  ScanLine,
  QrCode,
  ShieldCheck,
  ShieldAlert,
  Keyboard,
  Users,
  UserPlus,
} from "lucide-react";
import QRCode from "qrcode";
import { getJSON, postJSON } from "@/lib/api";
import { TokenBalance, RiskScreenResult, Contact } from "@/lib/types";
import { CoinLogo, ChainLogo } from "@furlpay/ui";
import { usd } from "@/components/ui";
import { AVATAR_COLORS, chainKind } from "@/lib/contactConstants";
import ContactAvatar from "@/components/ContactAvatar";
import ContactPicker from "@/components/ContactPicker";

// ---------------------------------------------------------------------------
// Scan to Pay — full-screen scanner + "My QR" receive view.
//   · Scan: camera viewfinder (BarcodeDetector, jsQR fallback), torch toggle,
//     manual address entry. A decoded address opens the Pay sheet: AML risk
//     screen → source balance → amount → gas-sponsored transfer (MFA step-up
//     for high-value sends, mirroring /api/wallets/transfer policy).
//   · My QR: shareable wallet QR — save as PNG, native share sheet, and
//     direct WhatsApp / Telegram / X share links.
// ---------------------------------------------------------------------------

export type ScanMode = "scan" | "myqr";

interface ScanToPayProps {
  open: boolean;
  mode?: ScanMode;
  onClose: () => void;
  onDone: () => void;
  user: { name: string; receiveAddress: string | null };
  balances: TokenBalance[];
  /** Open straight into the pay sheet with manual entry (P2P shortcut). */
  manualEntry?: boolean;
}

// Minimal typing for the native BarcodeDetector (not yet in lib.dom).
interface QrDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare const BarcodeDetector: { new (opts: { formats: string[] }): QrDetector } | undefined;

// Re-exported so existing importers keep working; the implementation (and its
// tests) now live in lib/qrPayload.ts.
export { parseQrPayload } from "@/lib/qrPayload";

/** Mock owner signature (0x + 130 hex) — real build signs with the passkey. */
function mockSignature(): string {
  const bytes = new Uint8Array(65);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

export default function ScanToPay({ open, mode: initialMode = "scan", onClose, onDone, user, balances, manualEntry }: ScanToPayProps) {
  const [mode, setMode] = useState<ScanMode>(initialMode);
  const [payTo, setPayTo] = useState<{ address: string; amount?: number; editable: boolean } | null>(
    manualEntry ? { address: "", editable: true } : null
  );

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setPayTo(manualEntry ? { address: "", editable: true } : null);
    }
  }, [open, initialMode, manualEntry]);

  // Lock background scroll while the overlay is up.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const scanning = mode === "scan" && !payTo;

  return (
    <div className="fixed inset-0 z-[70] flex justify-center bg-black" role="dialog" aria-modal aria-label="Scan to pay">
      <div className="relative flex h-full w-full max-w-[440px] flex-col">
        {/* Top bar */}
        <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-4">
          <button
            aria-label="Close"
            onClick={onClose}
            className="tap flex h-10 w-10 items-center justify-center rounded-full bg-black/50 backdrop-blur"
          >
            <X className="h-5 w-5" />
          </button>
          <p className="text-[15px] font-bold tracking-tight">{mode === "scan" ? "Scan to pay" : "My QR code"}</p>
          <div className="h-10 w-10">{/* torch renders inside CameraView so it can own the track */}</div>
        </header>

        {scanning && (
          <CameraView
            onScan={(payload) => {
              if (navigator.vibrate) navigator.vibrate(60);
              setPayTo({ address: payload.address, amount: payload.amount, editable: false });
            }}
            onManual={() => setPayTo({ address: "", editable: true })}
          />
        )}

        {mode === "myqr" && <MyQrView user={user} />}

        {/* Mode toggle */}
        {!payTo && (
          <div className="absolute inset-x-0 bottom-8 z-20 flex justify-center">
            <div className="flex rounded-full border border-white/10 bg-black/60 p-1 backdrop-blur">
              <ToggleBtn active={mode === "scan"} onClick={() => setMode("scan")} icon={<ScanLine className="h-4 w-4" />} label="Scan" />
              <ToggleBtn active={mode === "myqr"} onClick={() => setMode("myqr")} icon={<QrCode className="h-4 w-4" />} label="My QR" />
            </div>
          </div>
        )}

        {payTo && (
          <PaySheet
            to={payTo}
            balances={balances}
            onBack={() => setPayTo(null)}
            onPaid={() => {
              onDone();
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}

function ToggleBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
        active ? "bg-white text-black" : "text-textSecondary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Camera viewfinder with QR detection + torch.
// ---------------------------------------------------------------------------

function CameraView({ onScan, onManual }: { onScan: (p: { address: string; amount?: number }) => void; onManual: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopped = useRef(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [camError, setCamError] = useState(false);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      // `torch` is a real constraint on Android but missing from TS lib.dom.
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as unknown as MediaTrackConstraintSet] });
      setTorchOn((t) => !t);
    } catch {
      setTorchAvailable(false);
    }
  }, [torchOn]);

  useEffect(() => {
    stopped.current = false;
    let raf = 0;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });
        if (stopped.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {});

        const caps = stream.getVideoTracks()[0]?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
        setTorchAvailable(!!caps?.torch);

        const handle = (raw: string | undefined) => {
          if (!raw || stopped.current) return;
          const parsed = parseQrPayload(raw);
          if (parsed) {
            stopped.current = true;
            onScan(parsed);
          }
        };

        if (typeof BarcodeDetector !== "undefined") {
          const detector = new BarcodeDetector({ formats: ["qr_code"] });
          const tick = async () => {
            if (stopped.current) return;
            if (video.readyState >= 2) {
              const codes = await detector.detect(video).catch(() => []);
              handle(codes[0]?.rawValue);
            }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        } else {
          // Fallback decoder for browsers without BarcodeDetector.
          const { default: jsQR } = await import("jsqr");
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          timer = setInterval(() => {
            if (stopped.current || !ctx || video.readyState < 2) return;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            handle(code?.data);
          }, 180);
        }
      } catch {
        setCamError(true);
      }
    }

    void start();
    return () => {
      stopped.current = true;
      cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [onScan]);

  return (
    <div className="relative flex-1 overflow-hidden">
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />

      {/* Dim mask with a square cutout */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="relative h-[260px] w-[260px] rounded-[28px] shadow-[0_0_0_9999px_rgba(0,0,0,0.62)]">
          {/* Corner brackets */}
          {(["-top-px -left-px border-t-4 border-l-4 rounded-tl-[28px]",
            "-top-px -right-px border-t-4 border-r-4 rounded-tr-[28px]",
            "-bottom-px -left-px border-b-4 border-l-4 rounded-bl-[28px]",
            "-bottom-px -right-px border-b-4 border-r-4 rounded-br-[28px]"] as const).map((pos) => (
            <span key={pos} className={`absolute h-12 w-12 border-accent ${pos}`} />
          ))}
          {/* Scan line */}
          {!camError && (
            <span className="absolute inset-x-4 top-4 h-0.5 rounded-full bg-accent/90 shadow-[0_0_14px_2px_rgba(255,59,48,0.7)] animate-[scanline_2.2s_ease-in-out_infinite]" />
          )}
        </div>
      </div>

      {camError ? (
        <div className="absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 px-10 text-center">
          <p className="font-semibold">Camera unavailable</p>
          <p className="mt-1 text-[13px] text-textSecondary">Allow camera access, or enter the address manually below.</p>
        </div>
      ) : (
        <p className="absolute inset-x-0 top-[calc(50%+160px)] text-center text-[13px] text-white/80">
          Align a wallet QR inside the frame
        </p>
      )}

      {/* Torch */}
      {torchAvailable && (
        <button
          aria-label={torchOn ? "Turn flashlight off" : "Turn flashlight on"}
          onClick={toggleTorch}
          className={`tap absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full backdrop-blur ${
            torchOn ? "bg-white text-black" : "bg-black/50"
          }`}
        >
          {torchOn ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
        </button>
      )}

      {/* Manual entry */}
      <div className="absolute inset-x-0 bottom-24 flex justify-center">
        <button
          onClick={onManual}
          className="tap flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-[13px] font-semibold text-textSecondary backdrop-blur"
        >
          <Keyboard className="h-4 w-4" /> Enter address manually
        </button>
      </div>

      <style>{`@keyframes scanline{0%,100%{transform:translateY(0)}50%{transform:translateY(220px)}}`}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pay sheet — risk screen, source select, amount, transfer w/ MFA step-up.
// ---------------------------------------------------------------------------

function PaySheet({
  to,
  balances,
  onBack,
  onPaid,
}: {
  to: { address: string; amount?: number; editable: boolean };
  balances: TokenBalance[];
  onBack: () => void;
  onPaid: () => void;
}) {
  const [address, setAddress] = useState(to.address);
  const [amount, setAmount] = useState(to.amount ? String(to.amount) : "");
  const [srcIdx, setSrcIdx] = useState(0);
  const [note, setNote] = useState("");
  const [screen, setScreen] = useState<RiskScreenResult | null>(null);
  const [screening, setScreening] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paidTx, setPaidTx] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);

  const src = balances[srcIdx];
  const addressValid = useMemo(() => !!parseQrPayload(address), [address]);

  // The caller's address book for the SOURCE chain. Loaded once per chain so
  // the sheet can name a recipient without spending the resolve budget on an
  // address it can answer locally.
  const srcChain = src?.chain;
  useEffect(() => {
    if (!srcChain) return;
    const controller = new AbortController();
    getJSON<{ contacts: Contact[] }>(`/api/contacts?chain=${srcChain}`, { signal: controller.signal })
      .then((r) => setContacts(r.contacts))
      .catch(() => setContacts([]));
    return () => controller.abort();
  }, [srcChain]);

  // Who this address belongs to, if the user has saved them. Showing a name the
  // user chose themselves is the strongest confirmation available that the
  // money is going where they think — far stronger than a shortened hex string.
  const knownContact = useMemo(() => {
    if (!address.trim() || !srcChain) return undefined;
    // Matched by chain FAMILY, not by exact chain: one EVM address is payable
    // on every EVM chain, so a contact saved on Arbitrum is still this
    // recipient when the source balance sits on Base. And folded to lowercase
    // only for EVM — base58 is case-sensitive, so folding it would let two
    // different Solana keys compare equal.
    const fold = (value: string) =>
      chainKind(srcChain) === "evm" ? value.trim().toLowerCase() : value.trim();
    const key = fold(address);
    return contacts.find((c) => c.addresses.some((a) => fold(a.address) === key));
  }, [contacts, address, srcChain]);

  // AML screen the destination as soon as we have a plausible address.
  useEffect(() => {
    if (!addressValid) {
      setScreen(null);
      return;
    }
    let stale = false;
    setScreening(true);
    getJSON<{ result: RiskScreenResult }>(`/api/compliance?address=${encodeURIComponent(address)}`)
      .then((r) => !stale && setScreen(r.result))
      .catch(() => !stale && setScreen(null))
      .finally(() => !stale && setScreening(false));
    return () => {
      stale = true;
    };
  }, [address, addressValid]);

  const amt = Number(amount);
  const blocked = screen ? screen.sanctioned || screen.risk === "severe" : false;
  const canPay = addressValid && amt > 0 && !!src && amt <= src.amount && !blocked && !busy;

  async function pay() {
    if (!canPay) return;
    setBusy(true);
    setError(null);
    const res = await postJSON<{ transactionHash?: string; error?: string; stepUpRequired?: boolean }>("/api/wallets/transfer", {
      destination: address,
      amount: amt,
      token: src.token,
      chain: src.chain,
      signature: mockSignature(),
      ...(mfaCode ? { mfaCode } : {}),
      ...(note ? { deviceSignals: { note } } : {}),
    });
    setBusy(false);
    if (res.ok && res.data.transactionHash) {
      if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
      setPaidTx(res.data.transactionHash);
      return;
    }
    if (res.data.stepUpRequired) {
      setNeedsMfa(true);
      setError(mfaCode ? "Invalid code — try again." : null);
      return;
    }
    setError(res.data.error || "Payment failed. Please try again.");
  }

  if (paidTx) {
    return (
      <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black px-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gain/15 animate-[pop_.35s_ease-out]">
          <Check className="h-10 w-10 text-gain" strokeWidth={3} />
        </div>
        <p className="mt-5 text-2xl font-extrabold tracking-tight">{usd(amt)} sent</p>
        <p className="mt-1 text-[13px] text-textSecondary">
          {src.token} on {src.chain} · gas sponsored
        </p>
        <p className="mt-3 max-w-full truncate rounded-full bg-white/[0.06] px-3 py-1 font-mono text-[11px] text-textMuted">
          {short(paidTx)}
        </p>

        {/* The one moment the user knows exactly who this address belongs to.
            Asking later means asking about a hex string with no context. */}
        {!knownContact && src && (
          <SaveRecipient
            address={address}
            chain={src.chain}
            onSaved={(contact) => setContacts((prev) => [...prev, contact])}
          />
        )}

        <button onClick={onPaid} className="tap mt-8 w-full rounded-pill bg-accent py-3.5 font-semibold">
          Done
        </button>
        <style>{`@keyframes pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 rounded-t-[28px] border-t border-white/10 bg-charcoal p-5 pb-8 animate-[slideUp_.2s_ease-out]">
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold">Pay</h2>
        <button onClick={onBack} aria-label="Back to scanner" className="text-textSecondary hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Recipient */}
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[12px] text-textSecondary">To</label>
        {to.editable && src && (
          <button
            onClick={() => setPickerOpen(true)}
            className="tap flex items-center gap-1.5 text-[12px] font-semibold text-accent"
          >
            <Users className="h-3.5 w-3.5" /> Contacts
          </button>
        )}
      </div>

      {/* A saved contact outranks the raw string in both branches: the name is
          what the user verified, the hex is what they cannot. */}
      {knownContact ? (
        <div className="mb-2 flex items-center gap-3 rounded-2xl bg-surface px-4 py-3">
          <ContactAvatar
            name={knownContact.name}
            color={knownContact.avatarColor}
            size="sm"
            favorite={knownContact.isFavorite}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold">{knownContact.name}</span>
            <span className="block truncate font-mono text-[11px] text-textMuted">{short(address)}</span>
          </span>
          {to.editable && (
            <button
              onClick={() => setAddress("")}
              aria-label="Choose a different recipient"
              className="tap text-textSecondary hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : to.editable ? (
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value.trim())}
          placeholder="0x… or Solana address"
          autoFocus
          className="mb-2 w-full rounded-2xl bg-surface px-4 py-3 font-mono text-[13px] outline-none placeholder:text-textMuted"
        />
      ) : (
        <div className="mb-2 flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
          <span className="font-mono text-[13px]">{short(address)}</span>
        </div>
      )}

      {pickerOpen && src && (
        <div className="absolute inset-0 z-40 flex flex-col rounded-t-[28px] bg-charcoal p-5 pb-8">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-bold">Pay a contact</h3>
            <button onClick={() => setPickerOpen(false)} aria-label="Close contacts" className="text-textSecondary hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            <ContactPicker
              chain={src.chain}
              onPick={(picked) => {
                setAddress(picked.address);
                setPickerOpen(false);
              }}
            />
          </div>
        </div>
      )}

      {/* Risk screen result */}
      <div className="mb-3 min-h-[22px]">
        {screening && <span className="text-[12px] text-textMuted">Screening address…</span>}
        {!screening && screen && !blocked && (
          <span className="inline-flex items-center gap-1 rounded-full bg-gain/15 px-2.5 py-0.5 text-[11px] font-semibold text-gain">
            <ShieldCheck className="h-3.5 w-3.5" /> {screen.risk} risk · screened
          </span>
        )}
        {!screening && blocked && (
          <span className="inline-flex items-center gap-1 rounded-full bg-loss/15 px-2.5 py-0.5 text-[11px] font-semibold text-loss">
            <ShieldAlert className="h-3.5 w-3.5" /> Blocked by AML policy
          </span>
        )}
      </div>

      {/* Source balance */}
      <label className="mb-1 block text-[12px] text-textSecondary">Pay with</label>
      <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
        {balances.map((b, i) => (
          <button
            key={b.token + b.chain}
            onClick={() => setSrcIdx(i)}
            className={`flex shrink-0 items-center gap-2 rounded-2xl border px-3 py-2 ${
              i === srcIdx ? "border-accent bg-accent/10" : "border-white/[0.08] bg-surface"
            }`}
          >
            <CoinLogo token={b.token} size={22} />
            <span className="text-[13px] font-semibold">{b.token}</span>
            <ChainLogo chain={b.chain} size={14} />
            <span className="text-[11px] text-textMuted">{b.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
          </button>
        ))}
      </div>

      {/* Amount */}
      <label className="mb-1 block text-[12px] text-textSecondary">Amount (USD)</label>
      <input
        type="number"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.00"
        className="mb-2 w-full rounded-2xl bg-surface px-4 py-3 text-lg font-semibold outline-none"
      />
      <div className="mb-3 flex gap-2">
        {[10, 50, 100].map((v) => (
          <button key={v} onClick={() => setAmount(String(v))} className="rounded-full bg-white/[0.06] px-3 py-1 text-[12px] font-semibold text-textSecondary">
            ${v}
          </button>
        ))}
        {src && (
          <button onClick={() => setAmount(String(src.amount))} className="rounded-full bg-white/[0.06] px-3 py-1 text-[12px] font-semibold text-textSecondary">
            Max
          </button>
        )}
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note (optional)"
        className="mb-3 w-full rounded-2xl bg-surface px-4 py-2.5 text-[13px] outline-none placeholder:text-textMuted"
      />

      {needsMfa && (
        <>
          <label className="mb-1 block text-[12px] text-textSecondary">High-value transfer — enter your 6-digit authenticator code</label>
          <input
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="123456"
            className="mb-3 w-full rounded-2xl bg-surface px-4 py-3 text-center text-lg font-bold tracking-[0.4em] outline-none"
          />
        </>
      )}

      {src && amt > src.amount && <p className="mb-2 text-[12px] text-loss">Insufficient {src.token} balance on {src.chain}.</p>}
      {error && <div className="mb-3 rounded-2xl bg-loss/15 p-3 text-[13px] text-loss">{error}</div>}

      <button onClick={pay} disabled={!canPay} className="tap w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-40">
        {busy ? "Sending…" : amt > 0 ? `Pay ${usd(amt)}` : "Pay"}
      </button>
      <p className="mt-2 text-center text-[11px] text-textMuted">Gas sponsored by Furlpay · screened in real time</p>

      <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Save the address just paid, on the success screen.
//
// Deliberately here and not in a later prompt: right now the user knows who
// they paid. A day later the same question is about a hex string they cannot
// place, which is why address books stay empty and people keep pasting.
// ---------------------------------------------------------------------------

function SaveRecipient({
  address,
  chain,
  onSaved,
}: {
  address: string;
  chain: TokenBalance["chain"];
  onSaved: (contact: Contact) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Stable for the life of this success screen — re-picking on each render
  // would make the avatar flicker a new colour as the user types.
  const color = useMemo(() => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)], []);

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await postJSON<{ contact?: Contact; message?: string }>("/api/contacts", {
      name: name.trim(),
      avatarColor: color,
      addresses: [{ address, chain }],
    });
    setBusy(false);
    if (res.ok && res.data.contact) {
      onSaved(res.data.contact);
      setSaved(true);
      return;
    }
    setError(res.data.message ?? "Could not save that contact.");
  }

  if (saved) {
    return (
      <p className="mt-6 flex items-center gap-1.5 text-[13px] text-gain">
        <Check className="h-4 w-4" /> Saved to your address book
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="tap mt-6 flex items-center gap-2 rounded-pill bg-white/[0.08] px-4 py-2.5 text-[13px] font-semibold"
      >
        <UserPlus className="h-4 w-4" /> Save this recipient
      </button>
    );
  }

  return (
    <div className="mt-6 w-full">
      <div className="flex items-center gap-2">
        <ContactAvatar name={name || "?"} color={color} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this recipient"
          maxLength={64}
          autoFocus
          className="w-full rounded-2xl bg-white/[0.06] px-4 py-3 text-left text-[14px] font-semibold outline-none placeholder:text-textMuted"
        />
      </div>
      {error && <p className="mt-2 text-[12px] text-loss">{error}</p>}
      <button
        onClick={save}
        disabled={!name.trim() || busy}
        className="tap mt-2 w-full rounded-pill bg-white/[0.12] py-3 text-[14px] font-semibold disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save contact"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My QR — receive card with save / share.
// ---------------------------------------------------------------------------

// The address encoded here is one a stranger will scan in a shop and send money
// to, so it must be an address the user actually controls. It used to be
// `safeAddress` — sha256("furlpay:safe:" + key), with no private key behind it
// and no contract deployed at it. Everything sent to a QR of that is gone.
// `receiveAddress` is null until a wallet is linked and its EIP-191 proof
// verified, and a null renders an empty state rather than a QR of something
// address-shaped. See lib/receiveAddress.ts.
function MyQrView({ user }: { user: { name: string; receiveAddress: string | null } }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const address = user.receiveAddress;

  useEffect(() => {
    if (!address) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(address, {
      width: 640,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#0A0A0Cff", light: "#FFFFFFff" },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [address]);

  const shareText = address ? `Pay me on Furlpay — my wallet address: ${address}` : "";

  async function nativeShare() {
    try {
      if (qr && navigator.canShare) {
        const blob = await (await fetch(qr)).blob();
        const file = new File([blob], "furlpay-qr.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: "My Furlpay QR", text: shareText, files: [file] });
          return;
        }
      }
      await navigator.share({ title: "My Furlpay QR", text: shareText });
    } catch {
      /* user dismissed the sheet */
    }
  }

  function savePng() {
    if (!qr) return;
    const a = document.createElement("a");
    a.href = qr;
    a.download = "furlpay-qr.png";
    a.click();
  }

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const enc = encodeURIComponent(shareText);
  const socials: { label: string; href: string; bg: string; glyph: React.ReactNode }[] = [
    {
      label: "WhatsApp",
      href: `https://wa.me/?text=${enc}`,
      bg: "#25D366",
      glyph: (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#fff" aria-hidden>
          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.2 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .3-3.4-.7-2.9-1.2-4.7-4.1-4.9-4.3-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6l-.4.6-.5.5c-.1.2-.3.3-.1.7.2.3.8 1.4 1.8 2.2 1.2 1.1 2.3 1.4 2.6 1.6.3.2.5.1.7-.1l1-1.2c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.6.3 0 .2 0 .8-.2 1.4Z" />
        </svg>
      ),
    },
    {
      label: "Telegram",
      href: `https://t.me/share/url?url=${encodeURIComponent(address ?? "")}&text=${enc}`,
      bg: "#229ED9",
      glyph: (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#fff" aria-hidden>
          <path d="m21.9 4.6-3 14.3c-.2 1-.8 1.2-1.7.8l-4.6-3.4-2.2 2.1c-.3.3-.5.5-.9.5l.3-4.7L18.4 6c.4-.3-.1-.5-.6-.2L7.3 12.4l-4.5-1.4c-1-.3-1-1 .2-1.4L20.6 3.2c.8-.3 1.5.2 1.3 1.4Z" />
        </svg>
      ),
    },
    {
      label: "X",
      href: `https://twitter.com/intent/tweet?text=${enc}`,
      bg: "#111214",
      glyph: (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="#fff" aria-hidden>
          <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.2l7.3-8.3L1.4 2h6.5l4.4 5.9L18.9 2Zm-1.1 18.1h1.7L7 3.8H5.1l12.7 16.3Z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 pb-32 pt-20">
      {/* QR card */}
      <div className="mt-2 w-full max-w-[320px] rounded-[28px] bg-gradient-to-b from-white/[0.1] to-white/[0.04] p-[1px]">
        <div className="rounded-[27px] bg-charcoal p-6 text-center">
          <div className="mx-auto -mt-12 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accentDeep text-xl font-bold ring-4 ring-charcoal">
            {user.name.trim().charAt(0).toUpperCase()}
          </div>
          <p className="mt-2 text-[17px] font-bold tracking-tight">{user.name}</p>
          <p className="text-[11px] text-textMuted">Scan with any wallet or Furlpay</p>
          <div className="mx-auto mt-4 w-fit rounded-2xl bg-white p-3">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt={`QR code for ${address}`} className="h-[208px] w-[208px]" draggable={false} />
            ) : (
              <div className="h-[208px] w-[208px] animate-pulse rounded-xl bg-black/10" />
            )}
          </div>
          <button onClick={copyAddress} className="tap mx-auto mt-4 flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 font-mono text-[12px] text-textSecondary">
            {address ? short(address) : "No wallet linked"}
            {copied ? <Check className="h-3.5 w-3.5 text-gain" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-5 grid w-full max-w-[320px] grid-cols-2 gap-2">
        <button onClick={savePng} className="tap flex items-center justify-center gap-2 rounded-pill bg-white/[0.08] py-3 text-[14px] font-semibold">
          <Download className="h-4 w-4" /> Save
        </button>
        <button onClick={nativeShare} className="tap flex items-center justify-center gap-2 rounded-pill bg-accent py-3 text-[14px] font-semibold">
          <Share2 className="h-4 w-4" /> Share
        </button>
      </div>

      {/* Social share */}
      <div className="mt-5 flex items-center gap-5">
        {socials.map((s) => (
          <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={`Share on ${s.label}`} className="tap flex flex-col items-center gap-1.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: s.bg }}>
              {s.glyph}
            </span>
            <span className="text-[11px] text-textSecondary">{s.label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
