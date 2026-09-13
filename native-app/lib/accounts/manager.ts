import * as SecureStore from "expo-secure-store";
import { getDb, prefGet, prefSet } from "../db";
import { deriveAddress as deriveEvmAddress, ethPath } from "../wallet";
import { deriveSolanaAddress, solanaPath } from "../solana/wallet";
import { authenticateDeviceOwner } from "../biometrics";

// ---------------------------------------------------------------------------
// Multi-account manager.
//
// ONE PHRASE, MANY ACCOUNTS, TWO CHAINS. Every account is derived from the
// single BIP-39 mnemonic already on the device, at an incrementing BIP-44
// account index:
//
//     account N  ->  EVM     m/44'/60'/N'/0/0
//                ->  Solana  m/44'/501'/N'/0'
//
// Varying the ACCOUNT level is what MetaMask, Phantom and Ledger do for
// "Account 1, Account 2, …", so the same phrase restored in any of them shows
// the same list of addresses. There is still nothing extra to back up: the
// phrase reconstructs every account at every index, forever.
//
// WHAT IS PERSISTED, AND WHAT IS NOT. SQLite holds only the index, the label
// and the two PUBLIC addresses. The mnemonic stays in SecureStore behind the
// biometric gate and never touches the database — so a readable `furlpay.db`
// on a rooted device discloses which addresses exist, which is already public
// on chain, and nothing that can spend from them.
//
// Losing this table costs labels, not funds. Every address in it is
// re-derivable from the phrase at the same index; that is the whole point of
// deterministic derivation.
// ---------------------------------------------------------------------------

/** Same SecureStore key the wallet module uses — one mnemonic, not a copy. */
const MNEMONIC_KEY = "furlpay.wallet.mnemonic";
const ACTIVE_INDEX_PREF = "accounts.activeIndex";

/** Reading the mnemonic requires a biometric, matching lib/wallet.ts. */
const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface DerivedAccount {
  index: number;
  /** User-editable. Defaults to "Account {index + 1}". Never secret. */
  label: string;
  /** m/44'/60'/{index}'/0/0, EIP-55 checksummed. */
  evmAddress: string;
  /** m/44'/501'/{index}'/0', base58. */
  solanaAddress: string;
  createdAt: number;
}

interface AccountRow {
  idx: number;
  label: string;
  evm_address: string;
  solana_address: string;
  created_at: number;
}

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

/** Default label for an index. Human-facing, so 1-based. */
export function defaultLabel(index: number): string {
  return `Account ${index + 1}`;
}

function assertIndex(index: number): void {
  // The hardened BIP-44 ceiling. Beyond it the path is not derivable.
  if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff) {
    throw new AccountError(`Invalid account index: ${index}`);
  }
}

/**
 * Derive both addresses for an index. PURE — no storage, no biometric.
 *
 * The mnemonic is the caller's to obtain and the caller's to hold; this
 * function does not read SecureStore so it can be unit tested against known
 * vectors without a device.
 */
export function deriveAccountAtIndex(mnemonic: string, index: number): DerivedAccount {
  assertIndex(index);
  return {
    index,
    label: defaultLabel(index),
    evmAddress: deriveEvmAddress(mnemonic, index),
    solanaAddress: deriveSolanaAddress(mnemonic, index),
    createdAt: Date.now(),
  };
}

function rowToAccount(row: AccountRow): DerivedAccount {
  return {
    index: row.idx,
    label: row.label,
    evmAddress: row.evm_address,
    solanaAddress: row.solana_address,
    createdAt: row.created_at,
  };
}

/** Every created account, ordered by index. Needs no mnemonic and no biometric. */
export function listAccounts(): DerivedAccount[] {
  try {
    const rows = getDb().getAllSync<AccountRow>(
      "SELECT idx, label, evm_address, solana_address, created_at FROM accounts ORDER BY idx ASC",
    );
    return rows.map(rowToAccount);
  } catch {
    // A metadata read must never stop the app from starting. An empty list is
    // recoverable — the accounts re-derive from the phrase.
    return [];
  }
}

/** One account by index, or null. */
export function getAccount(index: number): DerivedAccount | null {
  assertIndex(index);
  try {
    const row = getDb().getFirstSync<AccountRow>(
      "SELECT idx, label, evm_address, solana_address, created_at FROM accounts WHERE idx = ?",
      index,
    );
    return row ? rowToAccount(row) : null;
  } catch {
    return null;
  }
}

/** The next unused index — max existing + 1, so a gap is never reused. */
export function nextAccountIndex(): number {
  const accounts = listAccounts();
  if (accounts.length === 0) return 0;
  return Math.max(...accounts.map((a) => a.index)) + 1;
}

/** Persist a derived account. Exported for the create path and for tests. */
export function saveAccount(account: DerivedAccount): void {
  getDb().runSync(
    "INSERT OR REPLACE INTO accounts (idx, label, evm_address, solana_address, created_at) VALUES (?, ?, ?, ?, ?)",
    account.index,
    account.label,
    account.evmAddress,
    account.solanaAddress,
    account.createdAt,
  );
}

/**
 * Create the next account.
 *
 * Gated on a biometric because it reads the mnemonic. Deriving an address is
 * not itself dangerous, but the phrase is the thing that spends, and every path
 * that touches it goes through the same gate — there is no "read it just this
 * once for something harmless" exception to maintain.
 */
export async function addAccount(label?: string): Promise<DerivedAccount> {
  // authenticateDeviceOwner, NOT confirmWithBiometrics.
  //
  // This gates ACCESS to the recovery phrase, which is the same class of thing
  // as revealing a card PAN — not an action inside an already-unlocked app.
  // `confirmWithBiometrics` short-circuits to true when the user has disabled
  // biometric approvals in Settings, which would turn a preference into a way
  // to read key material without proving device ownership. A device PIN,
  // pattern or passcode is an equally valid proof and nearly every phone has
  // one, so there is no device where this is merely inconvenient.
  const auth = await authenticateDeviceOwner("Authenticate to create a new account");
  if (!auth.ok) throw new AccountError("Authentication was cancelled or unavailable.");

  const mnemonic = await SecureStore.getItemAsync(MNEMONIC_KEY, SECURE_OPTS);
  if (!mnemonic) throw new AccountError("No wallet on this device.");

  const index = nextAccountIndex();
  const account = deriveAccountAtIndex(mnemonic, index);
  if (label?.trim()) account.label = label.trim().slice(0, 64);

  saveAccount(account);
  return account;
}

/** Rename an account. No biometric — a label is not secret and cannot spend. */
export function renameAccount(index: number, label: string): void {
  assertIndex(index);
  const trimmed = label.trim();
  if (!trimmed) throw new AccountError("Label cannot be empty.");
  getDb().runSync("UPDATE accounts SET label = ? WHERE idx = ?", trimmed.slice(0, 64), index);
}

/**
 * The active account index.
 *
 * Defaults to 0 on anything unexpected — a missing preference, a corrupt value,
 * or an index with no row. Account 0 always exists for a device that has a
 * wallet at all, so this cannot strand the UI pointing at nothing.
 */
export function getActiveAccountIndex(): number {
  const raw = prefGet(ACTIVE_INDEX_PREF);
  if (raw === null) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

/** Switch the active account. Refuses an index that has no stored account. */
export function setActiveAccountIndex(index: number): void {
  assertIndex(index);
  // Index 0 is always valid: it is the wallet's original account, which exists
  // whether or not a row was ever written for it.
  if (index !== 0 && !getAccount(index)) {
    throw new AccountError(`No account at index ${index}.`);
  }
  prefSet(ACTIVE_INDEX_PREF, String(index));
}

/** The derivation paths for an index, for display in a details screen. */
export function accountPaths(index: number): { evm: string; solana: string } {
  assertIndex(index);
  return { evm: ethPath(index), solana: solanaPath(index) };
}
