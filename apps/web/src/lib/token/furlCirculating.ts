import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { FURL_MINT, FURL_DEPLOYER, FURL_TOKEN_PROGRAM, baseUnitsToFurl } from "@/lib/token/furl";

// ---------------------------------------------------------------------------
// Circulating supply: which FURL is NOT in public float, and why.
//
// WHAT WAS WRONG BEFORE. The route excluded a holder if its share was "100.00"
// or if it was the only holder. That works for exactly today's state — one
// account holding everything — and silently breaks the moment the treasury
// migrates: with six multisigs holding 40/20/15/15/5/5, NO account is at 100%
// and there is more than one holder, so the heuristic would exclude NOTHING and
// report 1,000,000,000 FURL circulating. The number would jump from 0 to the
// entire supply on the day custody got SAFER, and any aggregator watching would
// print a market cap from it.
//
// So exclusion is now by IDENTITY, not by shape: we derive the associated token
// account of every issuer-controlled owner and match on those addresses.
// Adding a multisig is adding a row, and the arithmetic follows automatically.
//
// WHY THE TREASURY MIGRATION DOES NOT CHANGE CIRCULATING SUPPLY. All six
// allocations are issuer-controlled — community and partnership tokens are
// undistributed, team tokens unvested, treasury and reserve operational. Moving
// them from one issuer key to six issuer multisigs improves custody; it does not
// put a single token into public hands. Circulating supply correctly stays 0
// until FURL actually leaves issuer control.
// ---------------------------------------------------------------------------

export interface IssuerAccount {
  /** Owner address (wallet or multisig), not the token account. */
  readonly owner: string;
  /** Human label for the published exclusion list. */
  readonly label: string;
  readonly reason: string;
}

/**
 * Issuer-controlled owners. Their FURL is not in public float.
 *
 * ADD THE SIX SQUADS MULTISIGS HERE when the migration lands — and do not remove
 * the deployer until it genuinely holds nothing. Every entry is published in the
 * API response so each exclusion can be checked on-chain rather than trusted.
 */
export const ISSUER_OWNERS: readonly IssuerAccount[] = [
  {
    owner: FURL_DEPLOYER,
    label: "Deployer / treasury",
    reason: "Holds all undistributed supply and the mint authority",
  },
  // After migration, six entries replace the one above, e.g.:
  // { owner: "<community multisig>",    label: "Community & ecosystem (40%)", reason: "Undistributed community allocation" },
  // { owner: "<liquidity multisig>",    label: "Liquidity (20%)",             reason: "Reserved to seed the FURL/USDC pool" },
  // { owner: "<treasury multisig>",     label: "Treasury (15%)",              reason: "Operating treasury" },
  // { owner: "<team multisig>",         label: "Team & founders (15%)",       reason: "Unvested team allocation" },
  // { owner: "<partnerships multisig>", label: "Partnerships (5%)",           reason: "Undistributed partnership allocation" },
  // { owner: "<reserve multisig>",      label: "Security & launch reserve (5%)", reason: "Incident reserve" },
];

/** The FURL associated token account for an owner, under Token-2022. */
export function issuerTokenAccount(owner: string): string | null {
  try {
    return getAssociatedTokenAddressSync(
      new PublicKey(FURL_MINT),
      new PublicKey(owner),
      true, // allow off-curve: a Squads multisig vault is a PDA
      new PublicKey(FURL_TOKEN_PROGRAM),
    ).toBase58();
  } catch {
    // A malformed owner must not silently drop out of the exclusion set — the
    // caller treats null as "cannot attribute", which fails loudly upstream.
    return null;
  }
}

export interface ExcludedHolder {
  readonly tokenAccount: string;
  readonly owner: string;
  readonly label: string;
  readonly reason: string;
  readonly amount: string;
}

export interface CirculatingResult {
  readonly circulatingRaw: bigint;
  readonly excludedRaw: bigint;
  readonly excluded: ExcludedHolder[];
  /** Holders that count toward public float. */
  readonly publicHolders: { tokenAccount: string; amount: string }[];
  /** True when an issuer owner could not be resolved to a token account. */
  readonly unresolvedIssuer: boolean;
}

/**
 * Split holders into issuer-controlled and public float.
 *
 * `holders` comes from `getTokenLargestAccounts`, which returns TOKEN ACCOUNT
 * addresses — so issuer owners are resolved to their ATAs before matching.
 */
export function computeCirculating(
  totalRaw: bigint,
  holders: readonly { tokenAccount: string; amountRaw: string }[],
  issuers: readonly IssuerAccount[] = ISSUER_OWNERS,
): CirculatingResult {
  const byTokenAccount = new Map<string, IssuerAccount>();
  let unresolvedIssuer = false;

  for (const issuer of issuers) {
    const ata = issuerTokenAccount(issuer.owner);
    if (!ata) {
      unresolvedIssuer = true;
      continue;
    }
    byTokenAccount.set(ata, issuer);
  }

  let excludedRaw = 0n;
  const excluded: ExcludedHolder[] = [];
  const publicHolders: { tokenAccount: string; amount: string }[] = [];

  for (const holder of holders) {
    const issuer = byTokenAccount.get(holder.tokenAccount);
    const amount = BigInt(holder.amountRaw);
    if (issuer) {
      excludedRaw += amount;
      excluded.push({
        tokenAccount: holder.tokenAccount,
        owner: issuer.owner,
        label: issuer.label,
        reason: issuer.reason,
        amount: baseUnitsToFurl(amount),
      });
    } else {
      publicHolders.push({ tokenAccount: holder.tokenAccount, amount: baseUnitsToFurl(amount) });
    }
  }

  // Clamp at zero rather than going negative: excluded exceeding total would
  // mean the inputs disagree, and a negative circulating supply is nonsense to
  // publish. The caller checks `excludedRaw > totalRaw` to fail loudly instead.
  const circulatingRaw = totalRaw > excludedRaw ? totalRaw - excludedRaw : 0n;

  return { circulatingRaw, excludedRaw, excluded, publicHolders, unresolvedIssuer };
}
