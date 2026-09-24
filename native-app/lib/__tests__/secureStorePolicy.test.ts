import fs from "fs";
import path from "path";
import { DEVICE_ONLY, DEVICE_ONLY_BIOMETRIC, BACKGROUND_READABLE } from "../storageOptions";

// ---------------------------------------------------------------------------
// Every SecureStore write carries an explicit storage policy.
//
// THE DEFECT THIS GUARDS: the wallet mnemonic was stored correctly —
// requireAuthentication + WHEN_UNLOCKED_THIS_DEVICE_ONLY — while the session
// JWT, the anti-phishing phrase, the App Attest key id, the install id and both
// wallet addresses were each written with NO options at all. That takes the
// platform default, which on iOS admits the item to an encrypted iCloud
// Keychain backup: a bearer token that can move money could reappear on a
// restored device the user no longer holds.
//
// None of that was a decision. Each call site simply omitted the third
// argument, and an omission is invisible in review. So the test is written
// against the SHAPE of the call rather than against a list of known keys —
// a new `SecureStore.setItemAsync(FOO, bar)` added next month fails here
// without anyone having to remember this file exists.
// ---------------------------------------------------------------------------

const LIB = path.join(__dirname, "..");

/** Every .ts/.tsx under lib/, excluding tests and this policy module itself. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "__mocks__") continue;
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name) && entry.name !== "storageOptions.ts") {
      acc.push(full);
    }
  }
  return acc;
}

/** Finds the call site; the argument list is extracted by paren-balancing below. */
const CALL = /SecureStore\.(getItemAsync|setItemAsync|deleteItemAsync)\(/g;

/**
 * Argument list starting at `open` (the index of the `(`), paren-balanced.
 *
 * A `[^)]*` match is not sufficient and was wrong here: an argument may itself
 * be a call — `setItemAsync(SOL_ADDRESS_KEY, deriveSolanaAddress(mnemonic),
 * PUBLIC_OPTS)` — and stopping at the first `)` truncates the list before the
 * options argument, reporting a correctly-hardened call as an offender.
 */
function argumentList(src: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null; // unbalanced — treat as unparseable rather than as compliant
}

/**
 * Split on top-level commas only, so a nested call's own arguments do not
 * count as arguments of the SecureStore call.
 */
function topLevelArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of args) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

/** The option identifiers a call is allowed to pass. */
const ALLOWED_OPTIONS = [
  "DEVICE_ONLY",
  "DEVICE_ONLY_BIOMETRIC",
  "BACKGROUND_READABLE",
  // Local aliases for the above, used where the call site reads better with a
  // domain name (wallet.ts: SECURE_OPTS for the mnemonic, PUBLIC_OPTS for the
  // addresses). Both are assigned directly from the shared constants.
  "SECURE_OPTS",
  "PUBLIC_OPTS",
  "TOKEN_OPTS",
  "OPTS",
];

describe("SecureStore calls declare a storage policy", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(LIB)) {
    const src = fs.readFileSync(file, "utf8");
    for (const match of src.matchAll(CALL)) {
      const method = match[1];
      const open = match.index! + match[0].length - 1;
      const args = argumentList(src, open);
      // getItemAsync(KEY) / deleteItemAsync(KEY) take 2 args with options;
      // setItemAsync(KEY, value) takes 3. Either way the LAST argument must be
      // a recognised options identifier.
      const parts = args === null ? [] : topLevelArgs(args);
      const expected = method === "setItemAsync" ? 3 : 2;
      const last = parts[parts.length - 1] ?? "";
      const ok = parts.length >= expected && ALLOWED_OPTIONS.includes(last);
      if (!ok) {
        offenders.push(`${path.relative(LIB, file)}: SecureStore.${method}(${args ?? "<unparseable>"})`);
      }
    }
  }

  it("no call site omits its options argument", () => {
    expect(offenders).toEqual([]);
  });
});

describe("the policies themselves", () => {
  it("DEVICE_ONLY never leaves the device and needs no prompt", () => {
    expect(DEVICE_ONLY.keychainAccessible).toBe(
      require("expo-secure-store").WHEN_UNLOCKED_THIS_DEVICE_ONLY
    );
    // Deliberately absent: the session token is read on every API call,
    // including background refreshes, where there is no UI to prompt with.
    expect(DEVICE_ONLY.requireAuthentication).toBeUndefined();
  });

  it("DEVICE_ONLY_BIOMETRIC gates decryption on the device owner", () => {
    expect(DEVICE_ONLY_BIOMETRIC.requireAuthentication).toBe(true);
    expect(DEVICE_ONLY_BIOMETRIC.keychainAccessible).toBe(
      require("expo-secure-store").WHEN_UNLOCKED_THIS_DEVICE_ONLY
    );
  });

  it("every policy is ThisDeviceOnly — none may ride a backup off the device", () => {
    const store = require("expo-secure-store");
    const deviceOnly = [
      store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      store.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    ];
    for (const policy of [DEVICE_ONLY, DEVICE_ONLY_BIOMETRIC, BACKGROUND_READABLE]) {
      expect(deviceOnly).toContain(policy.keychainAccessible);
    }
  });
});
