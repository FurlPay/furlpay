import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { api, ApiError, demoSignature, NetworkError, TimeoutError } from "@/lib/api";
import { flagEnabled } from "@/lib/flags";
import { sendGasless } from "@/lib/wallet";
import { authorizeMoneyMove } from "@/lib/money/authorize";
import { transition, type TxState } from "@/lib/money/transactionState";
import {
  createTransaction,
  getTransaction,
  markUnknownOutcome,
  updateTransactionState,
} from "@/lib/money/transactionStore";
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
  /** Name of the address-book contact that owns this address, if any. */
  contactName?: string;
}): MoneyWarning[] {
  const { amountUsd, destination, balance, addressValid, recents, contactName } = input;
  return useMemo(() => {
    if (!balance) return [];
    return sendWarnings({
      amountUsd,
      destination,
      chain: balance.chain as ChainId,
      token: balance.token,
      known: isKnownRecipient(destination, recents),
      ...(contactName ? { contactName } : {}),
      lookalike: findLookalike(destination, recents),
      addressValid,
    });
  }, [amountUsd, destination, balance, addressValid, recents, contactName]);
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
  /**
   * Canonical transaction state.
   *
   * `stage` is the screen's own UI vocabulary and is kept for the existing
   * markup; `txState` is the money truth. They are not redundant: `stage`
   * reaching "settled" means the request resolved, `txState` reaching
   * COMPLETED means the SERVER confirmed it.
   */
  txState: TxState;
  /** Set when the risk engine refused. The API was never called. */
  blocked: string | null;
  /** Set when the payment needs review. The API was never called. */
  review: string | null;
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
  const [txState, setTxState] = useState<TxState>("CREATED");
  const [blocked, setBlocked] = useState<string | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SendReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [needsMfa, setNeedsMfa] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  // Guards a double-commit: the swipe control springs back on interrupt, and a
  // second confirm arriving while the first request is in flight must not send
  // a second transfer.
  const inFlight = useRef(false);
  /** The durable row this attempt belongs to, for the failure paths below. */
  const txIdRef = useRef<string | null>(null);

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
    setBlocked(null);
    setReview(null);

    // CLAIMED THE ATTEMPT HERE, NOT AFTER THE PROMPT.
    //
    // This flag used to be set immediately before the fetch, which left the
    // whole biometric window — seconds, and the one moment the app is NOT in
    // the foreground — outside the guard. A second execute() arriving then
    // passed `inFlight.current === false`, put up a second prompt, and ran a
    // second submission. The stable idempotency key means the server dedupes
    // the pair, so the money is safe; the user still gets two fingerprint
    // sheets for one payment and a receipt race deciding which reply is shown.
    //
    // Every early return below must release it, hence the try/finally that now
    // spans the authorization step as well as the request.
    if (inFlight.current) return;
    inFlight.current = true;

    // Built BEFORE the try, not inside it: the catch below queues this exact
    // payload to the outbox when the device turns out to be offline, and a
    // `const` declared inside the try block is not in scope there.
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

    // DURABLE IDENTITY BEFORE ANYTHING ELSE.
    //
    // The row is written before risk, before the prompt and before the request,
    // so a process death at any point after this leaves evidence of the attempt
    // and the key it belongs to. createTransaction returns the EXISTING row for
    // a repeated fingerprint, so a re-attempt of the same intent is the same
    // transaction rather than a second one.
    const key = idempotencyKeyFor(fingerprint);
    const tx = createTransaction({
      operation: "send",
      idempotencyKey: key,
      amountUsd: check.amountUsd,
      currency: balance.token,
      destination: payload.destination,
      reference: `Send to ${shortAddress(payload.destination)}`,
    });
    txIdRef.current = tx.id;

    setStage("authorizing");
    setTxState(tx.state);
    try {
      // THE authorization boundary: deterministic risk rules, then proof of
      // presence. Replaces confirmWithBiometrics, which returned TRUE when the
      // user had biometric approvals switched off or none enrolled — meaning
      // the highest-value path in the app could submit unauthenticated.
      //
      // BLOCK and REVIEW return before any request is built, so a refused
      // payment never reaches the financial API.
      const decision = await authorizeMoneyMove({
        action: "send_funds",
        amountUsd: check.amountUsd,
        reason: `Send ${usd(check.amountUsd)} to ${shortAddress(destination.trim())}`,
        // Upgrades this prompt from a LOCAL device check to a server-verified,
        // transaction-bound assertion when the device has a passkey registered.
        //
        // Read STRAIGHT OFF `payload` — never recomputed from form state. The
        // server re-derives the digest from the transfer it is about to execute,
        // so any divergence here (a rounded amount, a re-cased address, the USD
        // figure instead of token units) breaks the binding and silently drops
        // the payment back to TOTP. Sharing the object keeps the two identical
        // by construction rather than by care.
        payment: {
          amount: payload.amount,
          asset: payload.token,
          recipient: payload.destination,
          chain: payload.chain,
        },
        signals: {
          // Only signals this screen genuinely knows. `undefined` means "no
          // signal" to the engine, never "safe".
          knownBeneficiary: isKnownRecipient(destination.trim(), listRecentRecipients()),
        },
      });

      if (!decision.ok) {
        if (decision.kind === "blocked") setBlocked(decision.message);
        else if (decision.kind === "review") setReview(decision.message);
        else if (decision.kind !== "declined") setError(decision.message);
        // CANCELLED is the only legal exit from CREATED, and it is honest:
        // nothing left the device.
        setTxState(updateTransactionState(tx.id, "CANCELLED", { lastError: decision.message }).state);
        setStage("idle");
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      setStage("submitting");
      // The request is about to leave. From here the outcome is UNKNOWN, not
      // successful — a timeout past this point may still have landed. Persisted
      // BEFORE the await, so a death mid-flight is recoverable.
      setTxState(updateTransactionState(tx.id, "SUBMITTED").state);

      // ---------------------------------------------------------------------
      // RAIL SELECTION (self-custody Phase 4).
      //
      // Two rails, ONE surrounding safety envelope. Everything around this
      // branch — the durable row, the idempotency key, the outbox, the MFA
      // step-up, the state transitions — is identical for both, because the
      // property that must hold ("this transfer happens at most once, and its
      // outcome is never inferred") does not depend on which rail carries it.
      //
      // The self-custody rail is USDC-ONLY and deliberately so. sendGasless
      // parses the amount at 6 decimals and signs an EIP-3009 authorization
      // for a USDC contract; handing it a EURC or XSGD balance would sign a
      // number that is not the number the user typed, at a contract that is
      // not the token they picked. `check.amountUsd` equals the token amount
      // only for a dollar-pegged 1:1 asset, so the guard below is a
      // correctness requirement, not a product choice.
      // ---------------------------------------------------------------------
      const selfCustodyRail = flagEnabled("self_custody_send") && balance.token === "USDC";

      let res: { transactionHash?: string; confirmed: boolean };

      if (selfCustodyRail) {
        // Device-signed. Biometric gates the key read inside sendGasless; the
        // relayer pays gas and submits. No demoSignature is involved.
        const g = await sendGasless(payload.destination, String(check.amountUsd));

        if (g.kind === "unavailable") {
          // Honest refusal — nothing was broadcast. Same treatment as the demo
          // rail's 503 so the user reads one consistent message.
          setUnavailable(g.detail);
          setStage("idle");
          setTxState(updateTransactionState(tx.id, "CANCELLED", { lastError: g.detail }).state);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          return;
        }
        if (g.kind === "simulated") {
          // The server answered but is not in live mode. A simulated hash is
          // NOT a settlement and must never reach the success path — that is
          // the exact fabrication this whole rail exists to remove.
          const detail = "This environment simulates settlement — no USDC moved.";
          setUnavailable(detail);
          setStage("idle");
          setTxState(updateTransactionState(tx.id, "CANCELLED", { lastError: detail }).state);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          return;
        }
        // "settled" carries the required confirmation depth; "pending" means
        // broadcast but not yet deep enough, which is PROCESSING, not done.
        res = { transactionHash: g.transaction, confirmed: g.kind === "settled" };
      } else {
        const demo = await api<{ transactionHash: string }>("/wallets/transfer", {
          method: "POST",
          // The biometric proof travels with the transfer it was minted for. The
          // server matches it against the digest of THESE parameters, so it
          // satisfies the step-up gate without a TOTP round trip — and cannot be
          // reused for any other payment. Absent when the device has no passkey,
          // in which case the server asks for TOTP as before.
          body: decision.biometricProof
            ? { ...payload, biometricProof: decision.biometricProof }
            : payload,
          headers: { "Idempotency-Key": key },
        });
        res = { transactionHash: demo?.transactionHash, confirmed: Boolean(demo?.transactionHash) };
      }
      // The server answered. A transaction hash is the acknowledgement that it
      // accepted and broadcast the transfer; without one there is nothing to
      // call complete, and we say so rather than showing a tick.
      // Two ways to be un-finished, and both must land here rather than on the
      // success path: no hash at all, or a hash that is on the wire but not yet
      // confirmed to the depth this amount requires. Showing a tick for either
      // one would be inferring a completion we have not observed.
      if (!res.transactionHash || !res.confirmed) {
        setTxState(
          updateTransactionState(tx.id, "PROCESSING", {
            reconcileRequired: true,
            ...(res.transactionHash ? { transactionHash: res.transactionHash } : {}),
          }).state
        );
        setStage("submitting");
        setError(
          "Your payment was accepted but hasn't been confirmed yet. It will appear in your activity once it settles — don't send it again."
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      // Server-confirmed. PROCESSING then COMPLETED, because the state machine
      // forbids SUBMITTED -> COMPLETED: a completion must be observed, never
      // inferred from a resolved promise.
      updateTransactionState(tx.id, "PROCESSING");
      setTxState(
        updateTransactionState(tx.id, "COMPLETED", { transactionHash: res.transactionHash }).state
      );
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
        // Queued is NOT completed. The outbox holds it under the same
        // idempotency key; the money has not moved and must not read as if it
        // has. PROCESSING is the honest state: committed, outcome unknown.
        setTxState(
          updateTransactionState(tx.id, "PROCESSING", {
            lastError: "Queued while offline.",
            errorClass: "transport",
            reconcileRequired: true,
          }).state
        );
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
        // The server refused pending a second factor, so nothing was committed.
        // The durable row stays CREATED and keeps its key, so the retry with
        // the code is the SAME transaction rather than a second one.
        setTxState("CREATED");
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
        // Explicitly refused by the server before settlement — nothing moved.
        setTxState(updateTransactionState(tx.id, "CANCELLED", { lastError: detail }).state);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      setCorrelationId(correlationOf(e));

      // A TIMEOUT IS NOT A FAILURE. The request may have been accepted and the
      // reply lost. Telling the user "failed" here is what makes them pay
      // twice, so the transaction becomes PROCESSING + reconcileRequired and
      // recovery asks the server what actually happened.
      if (e instanceof TimeoutError) {
        setTxState(markUnknownOutcome(tx.id, "The network did not respond in time.").state);
        setStage("submitting");
        setError(
          "We didn't get a reply in time, so we don't yet know if this went through. We're checking — don't send it again."
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      setError(messageFor(e));
      setStage("failed");

      // Decide from the PERSISTED state, not from the `tx` snapshot taken
      // before the request (always CREATED) or from React's `stage` (a render
      // behind). The durable row is the only thing that knows whether the
      // request actually left: `transition` refuses CREATED -> FAILED, so an
      // error raised before submission stays CANCELLED — nothing left the
      // device — while one raised after submission becomes FAILED.
      const persisted = getTransaction(tx.id);
      const failState: TxState = persisted && persisted.state !== "CREATED" ? "FAILED" : "CANCELLED";
      setTxState(
        updateTransactionState(tx.id, failState, {
          lastError: messageFor(e),
          errorClass: e instanceof ApiError ? (e.status >= 500 ? "server" : "client") : "transport",
        }).state
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      inFlight.current = false;
    }
  }, [idempotencyKeyFor, refetchBalances, onSent]);

  return {
    stage,
    txState,
    blocked,
    review,
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
      setBlocked(null);
      setReview(null);
      setStage("idle");
      setTxState("CREATED");
    }, []),
  };
}

/** Chain label for copy, without every caller importing the catalogue. */
export function chainName(chain: string): string {
  return CHAINS[chain as ChainId]?.name ?? chain;
}
