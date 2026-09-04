import { readFileSync } from "fs";
import { join } from "path";
import { tryParseUsdcAmount } from "../money";
import { findLookalike, isKnownRecipient, type RecentRecipient } from "../send/lookalike";
import { LARGE_SEND_USD, sendWarnings } from "../send/warnings";

// Source-level regression tripwire for the Send screen, mirroring
// swapSafety.test.ts — and for the same reason. The Send tab shipped
// `Number(amount) > 0` once already; the rewrite moved its rules into
// lib/send/useSend.ts, and a render test would exercise one path where reading
// the source that ships catches a re-introduced `Number(amount)` anywhere.
//
// The properties pinned here are the ones that make a transfer safe to put
// behind a biometric prompt:
//   1. the amount is parsed to atomic units, never floated through Number()
//   2. validateSend remains the single authoritative gate before the request
//   3. the request is idempotent under retry
//   4. the clipboard is read only on user action, and never trusted raw
//   5. the recipient is shown in full for verification, never truncated

const root = join(__dirname, "..", "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const screenSrc = readFileSync(join(root, "app", "(tabs)", "send.tsx"), "utf8");
const hookSrc = readFileSync(join(root, "lib", "send", "useSend.ts"), "utf8");
const recipientSrc = readFileSync(join(root, "components", "send", "RecipientInput.tsx"), "utf8");

// Comments explain WHY each rule exists — only code counts.
const screenCode = strip(screenSrc);
const hookCode = strip(hookSrc);
const recipientCode = strip(recipientSrc);
const allCode = screenCode + "\n" + hookCode;

describe("send screen money-path safety", () => {
  it("never validates the amount with Number()", () => {
    expect(allCode).not.toMatch(/Number\(\s*amount\s*\)/);
  });

  it("parses the amount through lib/money", () => {
    expect(hookSrc).toMatch(/from "@\/lib\/money"/);
    expect(hookCode).toMatch(/tryParseUsdcAmount\(amount\)/);
  });

  it("bounds the amount input", () => {
    expect(screenCode).toMatch(/maxLength=\{AMOUNT_MAX_LENGTH\}/);
  });

  it("compares the USD amount against the balance's USD value, never its token amount", () => {
    // B2 from lib/sendValidation.ts: 2 SOL (~$350) vs a $100 entry must not
    // read as insufficient. The comparison lives in validateSend; what this
    // pins is that the hook did not reintroduce a parallel one against .amount.
    expect(hookCode).toMatch(/amountUsd > balance\.usdValue/);
    expect(hookCode).not.toMatch(/amountUsd > balance\.amount\b/);
  });

  it("keeps validateSend as the authoritative gate", () => {
    expect(hookSrc).toMatch(/from "@\/lib\/sendValidation"/);
    // Once for the live form state, once again inside execute.
    expect(hookCode.match(/validateSend\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(hookCode).toMatch(/canSend: check\.ok/);
  });

  it("re-validates inside execute before anything reaches the wire", () => {
    const execFn = hookCode.slice(hookCode.indexOf("const execute = useCallback"));
    const validateAt = execFn.indexOf("validateSend(");
    const requestAt = execFn.indexOf('"/wallets/transfer"');
    expect(validateAt).toBeGreaterThan(-1);
    expect(requestAt).toBeGreaterThan(validateAt);
    // A failed check must abandon, not fall through.
    expect(execFn.slice(validateAt, requestAt)).toMatch(/if \(!check\.ok\)/);
  });

  it("requires a biometric confirmation before submitting", () => {
    const execFn = hookCode.slice(hookCode.indexOf("const execute = useCallback"));
    const confirmAt = execFn.indexOf("confirmWithBiometrics");
    const requestAt = execFn.indexOf('"/wallets/transfer"');
    expect(confirmAt).toBeGreaterThan(-1);
    expect(requestAt).toBeGreaterThan(confirmAt);
    // A declined prompt must abandon, not fall through.
    expect(execFn.slice(confirmAt, requestAt)).toMatch(/if \(!confirmed\)/);
  });

  it("guards against a second submission while one is in flight", () => {
    expect(hookCode).toMatch(/inFlight/);
    expect(hookCode).toMatch(/inFlight\.current\)\s*return/);
  });

  it("sends an idempotency key that is stable for a given payload", () => {
    // A fresh key per attempt would let a request that timed out AFTER the
    // server accepted it be retried as a second, separate transfer.
    expect(hookCode).toMatch(/"Idempotency-Key": idempotencyKeyFor\(fingerprint\)/);
    expect(hookCode).toMatch(/idem\.current\?\.fingerprint !== fingerprint/);
    // …and that a step-up retry keeps it, because it is the same transfer.
    const stepUp = hookCode.slice(hookCode.indexOf("stepUpRequired"));
    expect(stepUp.slice(0, stepUp.indexOf("setError(messageFor"))).not.toMatch(
      /idem\.current = null/
    );
  });

  it("queues offline instead of failing, and does not retry blind", () => {
    expect(hookCode).toMatch(/instanceof NetworkError/);
    expect(hookCode).toMatch(/queuePendingAction\("transfer", payload\)/);
  });

  it("keeps the demo-signature warning attached to the payload that carries it", () => {
    // demoSignature() authorizes nothing; the comment is the only thing
    // stopping a future reader from treating this as a real authorization.
    expect(hookSrc).toMatch(/demoSignature\(\) is a random blob/);
    expect(hookSrc).toMatch(/signTransferAuthorization/);
  });
});

describe("clipboard handling", () => {
  it("reads the clipboard in lib, never in the screen", () => {
    expect(screenSrc).not.toMatch(/expo-clipboard/);
    expect(hookSrc).toMatch(/from "expo-clipboard"/);
  });

  it("never reads the clipboard speculatively", () => {
    // Android 12+ shows the user a system toast on every clipboard read. A peek
    // on mount would fire it every time the Send tab opens.
    const hook = hookCode.slice(
      hookCode.indexOf("export function useClipboardPaste"),
      hookCode.indexOf("// ── useSendValidation")
    );
    expect(hook).toContain("Clipboard.getStringAsync");
    expect(hook).not.toMatch(/useEffect/);
  });

  it("parses pasted text with the same parser the QR scanner uses", () => {
    // A raw clipboard string is not an address: it can be a payment link, or an
    // EIP-681 contract-call URI whose target is the TOKEN CONTRACT.
    expect(hookSrc).toMatch(/from "@\/lib\/qr"/);
    expect(hookCode).toMatch(/parseScannedAddress\(raw\)/);
    expect(hookCode).not.toMatch(/setDestination\(raw\)/);
  });

  it("only commits a paste that resolved to an address", () => {
    expect(screenCode).toMatch(/if \(address\) setDestination\(address\)/);
  });
});

describe("recipient verification", () => {
  it("shows the full address for checking, never a truncated one", () => {
    // Address poisoning survives exactly one thing: a user who checks only the
    // ends. The verification block renders every character.
    expect(recipientCode).toMatch(/grouped\(value\.trim\(\)\)/);
    expect(recipientCode).not.toMatch(/shortAddress\(value/);
  });

  it("tells the user the payment cannot be reversed, next to the address", () => {
    expect(recipientSrc).toMatch(/Compare every character/);
  });

  it("offers a tap-equivalent for the hold-to-paste gesture", () => {
    // A gesture-only affordance is unusable with a screen reader or limited
    // motor control, and this one is the primary way an address gets in.
    expect(recipientCode).toMatch(/onLongPress=\{hold\}/);
    expect(recipientCode).toMatch(/label="Paste"/);
    expect(recipientCode).toMatch(/accessibilityLabel=.*Paste address from clipboard/);
  });

  it("gives up the long press once the field has content, so the OS menu works", () => {
    expect(recipientCode).toMatch(/\{!value && editable \?/);
  });
});

describe("the send screen holds no money logic of its own", () => {
  // If validation or execution ever moves back into the screen, the tripwires
  // above would be reading a file that no longer contains the rules. Rather
  // than fail mysteriously later, fail here and now.

  it("issues no transfer requests directly", () => {
    expect(screenCode).not.toMatch(/api<[^>]*>\(\s*"\/wallets\/transfer"/);
    expect(screenCode).not.toMatch(/demoSignature/);
  });

  it("does not re-implement amount parsing", () => {
    expect(screenCode).not.toMatch(/parseUsdcAmount/);
  });

  it("delegates validation and execution to the hooks", () => {
    expect(screenSrc).toMatch(/from "@\/lib\/send\/useSend"/);
    expect(screenCode).toMatch(/useSendValidation\(/);
    expect(screenCode).toMatch(/useSendExecution\(/);
    expect(screenCode).toMatch(/useSendWarnings\(/);
  });

  it("blocks the confirm control and always says why", () => {
    expect(screenCode).toMatch(/disabled=\{!validation\.canSend\}/);
    expect(screenCode).toMatch(/disabledReason=\{validation\.blockedReason/);
  });
});

describe("the amounts the send screen must reject", () => {
  // The exact inputs `Number(x) > 0` waves through. Each truncates to zero
  // atomic USDC, i.e. a zero-value transfer the user biometrically approved.
  it.each(["0.0000001", "0.0000000001", "0.000000499"])("rejects sub-atomic %s", (input) => {
    expect(Number(input) > 0).toBe(true); // the old check passed it
    expect(tryParseUsdcAmount(input)).toBeNull(); // the new one does not
  });

  it.each(["0", "", "  ", "-5", "1e-7", "1,000", "abc"])("rejects %p", (input) => {
    expect(tryParseUsdcAmount(input)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Behaviour, not source: address poisoning and the warnings it produces.
// ---------------------------------------------------------------------------

const recent = (address: string): RecentRecipient => ({
  address,
  chain: "arbitrum",
  token: "USDC",
  lastUsedAt: Date.now(),
  count: 1,
});

// Same first 6 and last 4 characters, different middle — the signature of a
// mined address-poisoning address.
const REAL = "0x52908400098527886E0F7030069857D2E4169EE7";
const POISONED = "0x529084ffffffffffffffffffffffffffffff9EE7";
const UNRELATED = "0xde709f2102306220921060314715629080e2fb77";

describe("findLookalike — address poisoning", () => {
  it("flags an address that shortens to the same string as a known payee", () => {
    expect(findLookalike(POISONED, [recent(REAL)])?.address).toBe(REAL);
  });

  it("does not flag the known payee itself", () => {
    expect(findLookalike(REAL, [recent(REAL)])).toBeUndefined();
  });

  it("ignores case, so a checksum-cased paste is still caught", () => {
    expect(findLookalike(POISONED.toUpperCase(), [recent(REAL.toLowerCase())])).toBeDefined();
    expect(findLookalike(REAL.toUpperCase(), [recent(REAL.toLowerCase())])).toBeUndefined();
  });

  it("does not flag an ordinary different address", () => {
    expect(findLookalike(UNRELATED, [recent(REAL)])).toBeUndefined();
  });

  it("is quiet with no history and with an empty address", () => {
    expect(findLookalike(REAL, [])).toBeUndefined();
    expect(findLookalike("", [recent(REAL)])).toBeUndefined();
    expect(findLookalike("   ", [recent(REAL)])).toBeUndefined();
  });
});

describe("isKnownRecipient", () => {
  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(isKnownRecipient(`  ${REAL.toLowerCase()}  `, [recent(REAL)])).toBe(true);
    expect(isKnownRecipient(UNRELATED, [recent(REAL)])).toBe(false);
    expect(isKnownRecipient("", [recent(REAL)])).toBe(false);
  });
});

describe("sendWarnings", () => {
  const base = {
    destination: REAL,
    chain: "arbitrum" as const,
    token: "USDC",
    addressValid: true,
  };

  it("says nothing while the address is not yet valid", () => {
    expect(
      sendWarnings({ ...base, amountUsd: 50_000, known: false, addressValid: false })
    ).toEqual([]);
  });

  it("warns on a first-time recipient", () => {
    const w = sendWarnings({ ...base, amountUsd: 10, known: false });
    expect(w.map((x) => x.id)).toContain("first_time");
  });

  it("says nothing about familiarity for a known recipient", () => {
    const w = sendWarnings({ ...base, amountUsd: 10, known: true });
    expect(w).toEqual([]);
  });

  it("raises a danger-level look-alike warning, ranked above everything else", () => {
    const w = sendWarnings({
      ...base,
      destination: POISONED,
      amountUsd: LARGE_SEND_USD,
      known: false,
      lookalike: recent(REAL),
    });
    expect(w[0].id).toBe("lookalike");
    expect(w[0].level).toBe("danger");
    // A look-alike REPLACES "first time here" — both would be noise, and the
    // dangerous one must not be diluted.
    expect(w.map((x) => x.id)).not.toContain("first_time");
  });

  it("warns above the large-send threshold and not below it", () => {
    const big = sendWarnings({ ...base, amountUsd: LARGE_SEND_USD, known: true });
    const small = sendWarnings({ ...base, amountUsd: LARGE_SEND_USD - 0.01, known: true });
    expect(big.map((x) => x.id)).toContain("large_send");
    expect(small.map((x) => x.id)).not.toContain("large_send");
  });

  // ── address book ─────────────────────────────────────────────────────────
  //
  // A saved contact is a payee the user checked deliberately, with no money in
  // motion. Treating that as "first time sending here" is the warning-fatigue
  // failure this module's header argues against: it puts a banner on the screen
  // every single time someone pays their own landlord, and a banner that is
  // always there stops being read — including the day it is the look-alike one.

  it("does not call a saved contact a first-time recipient", () => {
    const w = sendWarnings({ ...base, amountUsd: 10, known: false, contactName: "Alice" });
    expect(w.map((x) => x.id)).not.toContain("first_time");
    expect(w).toEqual([]);
  });

  it("still raises the look-alike warning for a saved contact", () => {
    // The case that matters: a contact can itself be a poisoned address the
    // user saved by mistake. Suppressing the danger-level warning because a
    // name is attached would turn the address book into a way to silence the
    // one check that catches the attack.
    const w = sendWarnings({
      ...base,
      destination: POISONED,
      amountUsd: 10,
      known: false,
      contactName: "Alice",
      lookalike: recent(REAL),
    });
    expect(w[0].id).toBe("lookalike");
    expect(w[0].level).toBe("danger");
  });

  it("still warns on a large payment to a saved contact", () => {
    // Familiarity says nothing about size. A $50,000 send to someone you know
    // is exactly as irreversible as one to someone you do not.
    const w = sendWarnings({
      ...base,
      amountUsd: LARGE_SEND_USD,
      known: true,
      contactName: "Alice",
    });
    expect(w.map((x) => x.id)).toContain("large_send");
  });
});

// ---------------------------------------------------------------------------
// The asset pill. Three defects found on-device, pinned so they cannot return:
//   1. the pill was disabled with zero balances — dead exactly when a user taps
//      it to ask why they cannot send
//   2. it rendered "Arbitrum One" under a pill reading "Select", stating a
//      network the user had not chosen
//   3. the picker it opened was an empty dead end
// ---------------------------------------------------------------------------

const panelSrc = readFileSync(join(root, "components", "money", "ValuePanel.tsx"), "utf8");
const panelCode = strip(panelSrc);
const selectorCode = strip(
  readFileSync(join(root, "components", "send", "SourceSelector.tsx"), "utf8")
);

describe("choosing what to pay with", () => {
  it("never disables the asset pill on the send screen", () => {
    const pill = screenCode.slice(
      screenCode.indexOf("<ValuePanel"),
      screenCode.indexOf("</ValuePanel>")
    );
    expect(pill).not.toMatch(/disabled=/);
  });

  it("does not default the network to a chain the user never picked", () => {
    expect(screenCode).not.toMatch(/\?\?\s*"arbitrum"/);
    expect(screenCode).toMatch(/chain=\{selected\?\.chain as ChainId \| undefined\}/);
  });

  it("renders no chain name unless an asset is actually selected", () => {
    // `chainName` is the only source of the network line, and it is gated on
    // BOTH an asset and a chain being present.
    expect(panelCode).toMatch(/const chainName = asset && chain \?/);
  });

  it("treats the chain as optional throughout the send composer", () => {
    expect(panelCode).toMatch(/chain\?: ChainId/);
    expect(recipientCode).toMatch(/chain\?: ChainId/);
  });

  it("asks for a generic address until the asset decides the format", () => {
    expect(recipientCode).toMatch(/!chain \? "Wallet address"/);
  });

  it("offers a way out of an empty balance list instead of dead-ending", () => {
    expect(selectorCode).toMatch(/Nothing to send yet/);
    expect(selectorCode).toMatch(/router\.push\("\/receive"\)/);
  });
});
