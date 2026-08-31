import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { api, ApiError, demoSignature, NetworkError } from "@/lib/api";
import { confirmWithBiometrics } from "@/lib/biometrics";
import { queuePendingAction } from "@/lib/db";
import { correlationOf, messageFor, type ExecutionStage } from "@/lib/execution";
import { isValidDestination, shortAddress, usd } from "@/lib/format";
import { parseUsdcAmount, tryParseUsdcAmount } from "@/lib/money";
import { parseScannedAddress } from "@/lib/qr";
import { useInvalidateAfterMoneyMove, useOverview } from "@/lib/queries";
import { validateSend } from "@/lib/sendValidation";
import { assetBySymbol, CHAINS, type ChainId, type SwapAsset } from "@/lib/swap/assets";
import type { MoneyWarning } from "@/lib/warnings";
import type { TokenBalance } from "@/lib/types";
import {
  findLookalike,
  isKnownRecipient,
  listRecentRecipients,
  rememberRecipient,
  type RecentRecipient,
} from "./recipients";
import { sendWarnings } from "./warnings";

// ---------------------------------------------------------------------------
// Send state, extracted from the screen for the same reason swap's is
// (lib/swap/useSwap.ts): the rules are testable without mounting a component,
// and changing how the screen LOOKS cannot change what it is allowed to DO.
//
// Every safety property the previous Send tab had is preserved verbatim:
//   * the amount is parsed to atomic units via lib/money, never Number()
//   * the USD amount is compared against the balance's USD VALUE, not its
//     token amount
//   * validateSend() remains the single authoritative gate before execution —
//     the granular per-field errors below are for display only
//   * biometric confirmation happens before the request, and a declined prompt
//     abandons rather than falling through
//   * offline queues to the outbox instead of failing
//
// And two properties it did NOT have:
//   * the Idempotency-Key is STABLE for a given payload, so retrying after a
//     timeout cannot double-send (see useSendExecution)
//   * a second confirm arriving mid-flight is refused, as on the swap screen
// ---------------------------------------------------------------------------

/** Mirrors AMOUNT_MAX_LENGTH on the swap screen — the same field, same cap. */
export const AMOUNT_MAX_LENGTH = 20;

export type { RecentRecipient };

// ── assets ─────────────────────────────────────────────────────────────────

/**
 * A drawable asset for any token the balances endpoint returns.
 *
 * The catalogue in lib/swap/assets.ts covers what can be SWAPPED; /overview can
 * legitimately return a token outside it. Rather than render "Select" (which
 * reads as "you have not chosen yet") or invent a brand colour, unknown tokens
 * get a neutral surface and their own first character. Nothing is fabricated —
 * the glyph is the symbol.
 */
export function assetForToken(token: string): SwapAsset {
  const known = assetBySymbol(token);
  if (known) return known;
  return {
    symbol: token,
    name: token,
    assetClass: "stablecoin",
    chains: [],
    color: "#2A2A2A",
    glyph: token.slice(0, 1).toUpperCase() || "?",
    decimals: 6,
  };
}

// ── useSendBalances ────────────────────────────────────────────────────────

/**
 * Spendable balances.
 *
 * Reads the same cached /overview the home tab holds rather than adding a
 * request — identical to useTokenBalances on the swap screen, including the
 * `known` flag that distinguishes a real zero from an unloaded balance.
 */
export function useSendBalances() {
  const { data, isLoading, refetch } = useOverview();

  const balances = useMemo<TokenBalance[]>(() => data?.data.tokenBalances ?? [], [data]);

  const balanceOf = useCallback(
    (token: string, chain: string): TokenBalance | undefined =>
      balances.find((b) => b.token === token && b.chain === chain),
    [balances]
  );

  return {
    balances,
    balanceOf,
    isLoading,
    refetch,
    known: data !== undefined,
    fromCache: data?.fromCache ?? false,
  };
}

// ── useRecipients ──────────────────────────────────────────────────────────

/** The persisted payee history, plus the recorder used after a successful send. */
export function useRecipients() {
  const [recents, setRecents] = useState<RecentRecipient[]>([]);

  useEffect(() => {
    setRecents(listRecentRecipients());
  }, []);

  const remember = useCallback((input: { address: string; chain: TokenBalance["chain"]; token: string }) => {
    setRecents(rememberRecipient(input));
  }, []);

  return { recents, remember };
}

// ── useClipboardPaste ──────────────────────────────────────────────────────

export interface UseClipboardPaste {
  /** Reads the clipboard and returns a payable address, or null. */
  paste: () => Promise<string | null>;
  /** Set when the last paste attempt found nothing usable. */
  notice: string | null;
  clearNotice: () => void;
}

/**
 * Clipboard → address, on explicit user action only.
 *
 * THE CLIPBOARD IS NEVER READ SPECULATIVELY. Android 12+ shows the user a
 * system toast every time an app reads the clipboard, and a wallet that peeks
 * on mount produces "FurlPay pasted from your clipboard" every time the Send
 * tab opens — which is both alarming and, on a payments app, a reasonable thing
 * for a user to be alarmed by. The read happens when the user taps Paste or
 * holds the recipient card, and at no other time.
 *
 * The pasted text goes through `parseScannedAddress`, the SAME parser the QR
 * scanner uses, so a copied furlpay.com/pay link, an `ethereum:` URI or a
 * Solana Pay URI all resolve to the payee — and an EIP-681 contract-call URI
 * resolves to the payee rather than to the token contract, which is the case
 * that would otherwise burn the funds.
 */
export function useClipboardPaste(): UseClipboardPaste {
  const [notice, setNotice] = useState<string | null>(null);

  const paste = useCallback(async (): Promise<string | null> => {
    setNotice(null);
    let raw = "";
    try {
      raw = (await Clipboard.getStringAsync()) ?? "";
    } catch {
      setNotice("Couldn't read the clipboard.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return null;
    }

    if (!raw.trim()) {
      setNotice("Your clipboard is empty.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return null;
    }

    const address = parseScannedAddress(raw);
    if (!address) {
      setNotice("That clipboard text isn't a payable address.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return null;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    return address;
  }, []);

  return { paste, notice, clearNotice: useCallback(() => setNotice(null), []) };
}

// ── useSendValidation ──────────────────────────────────────────────────────

export interface SendValidation {
  /** Atomic units, or null when the amount is not a valid money string. */
  atomic: bigint | null;
  amountUsd: number;
  /** Amount-field error, shown under the amount. */
  amountError: string | null;
  /** Recipient-field error, shown under the recipient. */
  addressError: string | null;
  addressValid: boolean;
  insufficientBalance: boolean;
  /** The authoritative gate — validateSend's verdict, nothing else. */
  canSend: boolean;
  /** Why the confirm control is blocked, written for a user. */
  blockedReason: string | null;
  /** The amount expressed in the source token, when a unit price is known. */
  tokenEquivalent: number | undefined;
}

export function useSendValidation(
  destination: string,
  amount: string,
  balance: TokenBalance | null
): SendValidation {
  const trimmed = destination.trim();

  // Never Number(): "0.0000001" passes `Number(x) > 0` and then truncates to
  // zero atomic units, which is how a zero-value transfer gets biometric
  // approval. This is the bug lib/sendValidation.ts was created to close.
  const atomic = useMemo(() => tryParseUsdcAmount(amount), [amount]);
  const amountUsd = atomic === null ? 0 : Number(atomic) / 1_000_000;

  const amountError = useMemo(() => {
    // An empty field is "not finished", not "wrong" — no red text while typing.
    if (atomic !== null || !amount.trim()) return null;
    try {
      parseUsdcAmount(amount);
      return null;
    } catch (e) {
      return (e as Error).message; // AmountError messages are user-facing
    }
  }, [amount, atomic]);

  const addressValid = !!trimmed && !!balance && isValidDestination(trimmed, balance.chain);

  const addressError = useMemo(() => {
    if (!trimmed || !balance || addressValid) return null;
    return balance.chain === "solana"
      ? "That isn't a Solana address. Solana addresses are 32–44 base58 characters."
      : "That isn't an EVM address. It should start with 0x and be 42 characters.";
  }, [trimmed, balance, addressValid]);

  const insufficientBalance =
    balance !== null && atomic !== null && amountUsd > balance.usdValue;

  // THE gate. Display state above is derived for the user's benefit; what
  // actually decides whether a send may proceed is the function the unit tests
  // pin (lib/__tests__/sendValidation.test.ts).
  const check = useMemo(
    () => validateSend({ destination, amount, balance }),
    [destination, amount, balance]
  );

  const blockedReason = useMemo(() => {
    if (!balance) return "No balance to send from.";
    if (!trimmed) return "Enter a recipient address";
    if (addressError) return addressError;
    if (!amount.trim()) return "Enter an amount";
    if (amountError) return amountError;
    if (insufficientBalance) {
      return `You have ${usd(balance.usdValue)} in ${balance.token}.`;
    }
    return check.ok ? null : check.error;
  }, [balance, trimmed, addressError, amount, amountError, insufficientBalance, check]);

  /**
   * The amount restated in the source token.
   *
   * This is validateSend's own `amountTokens` — the exact number that goes on
   * the wire — so the token figure the user reads is the quantity that will be
   * debited, not a second independent estimate of it. With no priceable
   * balance the line simply does not render: a made-up token figure next to a
   * real dollar one is indistinguishable from a real one.
   */
  const tokenEquivalent = check.ok ? check.amountTokens : undefined;

  return {
    atomic,
    amountUsd: check.ok ? check.amountUsd : amountUsd,
    amountError,
    addressError,
    addressValid,
    insufficientBalance,
    canSend: check.ok,
    blockedReason,
    tokenEquivalent,
  };
}

// ── useSendWarnings ────────────────────────────────────────────────────────

export function useSendWarnings(input: {
  amountUsd: number;
  destination: string;
  balance: TokenBalance | null;
  addressValid: boolean;
  recents: RecentRecipient[];
}): MoneyWarning[] {
  const { amountUsd, destination, balance, addressValid, recents } = input;
  return useMemo(() => {
    if (!balance) return [];
    return sendWarnings({
      amountUsd,
      destination,
      chain: balance.chain as ChainId,
      token: balance.token,
      known: isKnownRecipient(destination, recents),
      lookalike: findLookalike(destination, recents),
      addressValid,
    });
  }, [amountUsd, destination, balance, addressValid, recents]);
}

// ── useSendExecution ───────────────────────────────────────────────────────

export interface SendReceipt {
  kind: "sent" | "queued";
  /** Present only when the rail returned one. */
  transactionHash?: string;
  amountUsd: number;
  token: string;
  chain: ChainId;
  destination: string;
}

export interface SendDraft {
  destination: string;
  /**
   * The raw amount string the user typed.
   *
   * Deliberately NOT a number: execution re-runs validateSend on this exact
   * string, so the figure that reaches the wire comes from the same parse the
   * screen displayed, with no float round-trip in between to disagree with it.
   */
  amount: string;
  balance: TokenBalance | null;
  mfaCode: string;
}

export interface UseSendExecution {
  stage: ExecutionStage;
  executing: boolean;
  receipt: SendReceipt | null;
  error: string | null;
  correlationId: string | null;
  /** True once the server has demanded a step-up code for this transfer. */
  needsMfa: boolean;
  /** Set when this deployment has transfers switched off (server 503). */
  unavailable: string | null;
  execute: () => Promise<void>;
  dismiss: () => void;
}

export function useSendExecution(
  draft: SendDraft,
  onSent?: (receipt: SendReceipt) => void
): UseSendExecution {
  const refetchBalances = useInvalidateAfterMoneyMove();
  const [stage, setStage] = useState<ExecutionStage>("idle");
  const [receipt, setReceipt] = useState<SendReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  // Guards a double-commit: the swipe control springs back on interrupt, and a
  // second confirm arriving while the first request is in flight must not send
  // a second transfer.
  const inFlight = useRef(false);

  /**
   * Idempotency key, STABLE for a given payload.
   *
   * The old screen minted a fresh key on every attempt, which defeats the
   * point: a request that timed out after the server accepted it would be
   * retried under a new key and sent twice. The key is therefore tied to the
   * payload fingerprint — retrying the same transfer replays the same key (the
   * server dedupes), while changing the amount or the recipient is a different
   * transfer and gets a new one.
   */
  const idem = useRef<{ fingerprint: string; key: string } | null>(null);
  const idempotencyKeyFor = useCallback((fingerprint: string): string => {
    if (idem.current?.fingerprint !== fingerprint) {
      idem.current = { fingerprint, key: crypto.randomUUID() };
    }
    return idem.current.key;
  }, []);

  const latest = useRef(draft);
  latest.current = draft;

  const execute = useCallback(async () => {
    const { destination, amount, balance, mfaCode } = latest.current;
    if (!balance || inFlight.current) return;

    // Re-run the authoritative gate against the values being submitted. The
    // control is already disabled when this fails; this is the belt to that
    // braces, so a stale render can never put an invalid transfer on the wire.
    const check = validateSend({ destination, amount, balance });
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setError(null);
    setCorrelationId(null);
    setUnavailable(null);

    setStage("authorizing");
    // Biometric confirmation before any money moves (honors the Settings →
    // Security → "Biometric approvals" preference).
    const confirmed = await confirmWithBiometrics(
      `Send ${usd(check.amountUsd)} to ${shortAddress(destination.trim())}`
    );
    if (!confirmed) {
      setStage("idle");
      return;
    }

    const payload = {
      destination: destination.trim(),
      // TOKEN units, not the USD the field is denominated in.
      // /api/wallets/transfer spends this against the token balance
      // (`src.amount -= amount`) — posting the USD figure debited the wrong
      // quantity of every token that is not 1:1 with the dollar (EURC, XSGD,
      // SOL). validateSend converts at the server-priced unit rate.
      amount: check.amountTokens,
      token: balance.token,
      chain: balance.chain,
      // SECURITY: demoSignature() is a random blob — it authorizes NOTHING.
      // /wallets/transfer is the demo-ledger custodial path (mock recovery,
      // same as the web dashboard); its real authorization is the session JWT.
      // If this endpoint is ever wired to real settlement, this screen MUST
      // switch to lib/wallet.ts signTransferAuthorization (genuine EIP-3009,
      // biometric-gated) — see sendGasless for the working pattern.
      signature: demoSignature(),
      ...(mfaCode ? { mfaCode } : {}),
    };

    const fingerprint = `${payload.destination}|${payload.amount}|${payload.token}|${payload.chain}`;

    inFlight.current = true;
    setStage("submitting");
    try {
      const res = await api<{ transactionHash: string }>("/wallets/transfer", {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": idempotencyKeyFor(fingerprint) },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const done: SendReceipt = {
        kind: "sent",
        transactionHash: res.transactionHash,
        amountUsd: check.amountUsd,
        token: balance.token,
        chain: balance.chain as ChainId,
        destination: payload.destination,
      };
      setReceipt(done);
      setStage("settled");
      // This transfer is finished — the next one is a new transfer even if the
      // user re-enters identical details.
      idem.current = null;
      onSent?.(done);
      refetchBalances();
    } catch (e) {
      if (e instanceof NetworkError) {
        // Offline: queue in the outbox; OfflineBanner flushes when back online.
        // The queued action carries its own idempotency key (lib/db.ts), so the
        // flush cannot duplicate this transfer either.
        queuePendingAction("transfer", payload);
        const queued: SendReceipt = {
          kind: "queued",
          amountUsd: check.amountUsd,
          token: balance.token,
          chain: balance.chain as ChainId,
          destination: payload.destination,
        };
        setReceipt(queued);
        setStage("settled");
        idem.current = null;
        onSent?.(queued);
        return;
      }

      if (e instanceof ApiError && (e.data as { stepUpRequired?: boolean } | null)?.stepUpRequired) {
        // Not a failure — the server wants a second factor for this amount.
        // Keep the key: the retry with the code is the SAME transfer.
        setNeedsMfa(true);
        setError("High-value transfer — enter your authenticator code to continue.");
        setStage("idle");
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      // This deployment accepts no transfers on the demo rail (the NODE_ENV
      // gate in apps/web/src/app/api/wallets/transfer). That is a product
      // state, not a failure, and it deserves its own message rather than a red
      // error implying the user did something wrong. Nothing was charged.
      const code = e instanceof ApiError ? (e.data as { error?: string } | null)?.error : undefined;
      if (code === "service_unavailable" || (e instanceof ApiError && e.status === 503)) {
        const detail =
          (e instanceof ApiError ? (e.data as { detail?: string } | null)?.detail : undefined) ??
          "Sending isn't enabled in this environment. Nothing left your account.";
        setUnavailable(detail);
        setStage("idle");
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      setError(messageFor(e));
      setCorrelationId(correlationOf(e));
      setStage("failed");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      inFlight.current = false;
    }
  }, [idempotencyKeyFor, refetchBalances, onSent]);

  return {
    stage,
    executing: stage === "authorizing" || stage === "submitting",
    receipt,
    error,
    correlationId,
    needsMfa,
    unavailable,
    execute,
    dismiss: useCallback(() => {
      setReceipt(null);
      setError(null);
      setCorrelationId(null);
      setNeedsMfa(false);
      setUnavailable(null);
      setStage("idle");
    }, []),
  };
}

/** Chain label for copy, without every caller importing the catalogue. */
export function chainName(chain: string): string {
  return CHAINS[chain as ChainId]?.name ?? chain;
}
