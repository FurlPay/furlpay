#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Register pilot collection addresses for ONE merchant on a local or staging
// database, so hosted checkout stops answering `rail_unavailable`.
//
//   PILOT_DESTINATION_MNEMONIC="<your own test mnemonic>" \
//   DATABASE_URL=postgres://...            # or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   npm run merchant:seed-destinations -- --merchant=<uuid> --count=5 [--chains=arbitrum,base,arc] [--dry-run]
//
// WHAT IT WILL NOT DO, ON PURPOSE:
//   * Generate keys. Checkout chains are MAINNETS: a customer paying a pilot
//     link sends real USDC to these addresses. They are derived from a mnemonic
//     YOU already hold (m/44'/60'/0'/0/i), so the funds are recoverable. The
//     script never prints or stores a key.
//   * Touch production. The production Supabase project is refused outright;
//     production addresses come from the custody provider via
//     /dashboard/operations.
//   * Skip proof of control. Each row is accompanied by the same EIP-191
//     registration signature the operator console requires
//     (lib/payments/merchant/destinationMessage.ts), verified before insert.
//   * Solana. Ed25519 HD derivation needs a dependency this app does not
//     carry; register Solana addresses through the operator console.
// ---------------------------------------------------------------------------
import { mnemonicToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { pathToFileURL } from "node:url";

export const PRODUCTION_PROJECT_REF = "iyarllmcednkbekweucd";
export const SEEDABLE_CHAINS = ["arbitrum", "base", "arc", "polygon", "ethereum"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Must equal lib/payments/merchant/destinationMessage.ts byte for byte (enforced by a test). */
export function registrationMessage(merchantId, chain, address, custodyReference) {
  return ["FurlPay collection address registration", `Merchant: ${merchantId}`, `Chain: ${chain}`, `Address: ${address}`, `Custody reference: ${custodyReference}`].join("\n");
}

export function parseArgs(argv) {
  const get = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const merchantId = get("merchant");
  const count = Number(get("count") ?? 5);
  const chains = (get("chains") ?? "arbitrum,base,arc").split(",").map((c) => c.trim()).filter(Boolean);
  if (!merchantId || !UUID.test(merchantId)) throw new Error("--merchant=<uuid> is required");
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("--count must be 1-20");
  const bad = chains.filter((c) => !SEEDABLE_CHAINS.includes(c));
  if (bad.length) throw new Error(`unsupported chain(s): ${bad.join(", ")} (EVM chains with a deposit policy: ${SEEDABLE_CHAINS.join(", ")})`);
  return { merchantId, count, chains, dryRun: argv.includes("--dry-run") };
}

export function assertNotProduction(env) {
  const targets = [env.DATABASE_URL, env.SUPABASE_URL].filter(Boolean).join(" ");
  if (!targets) throw new Error("set DATABASE_URL, or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  if (targets.includes(PRODUCTION_PROJECT_REF)) throw new Error("refusing: this is the PRODUCTION database. Register production addresses through /dashboard/operations with custody-provider signatures.");
}

/** Derive, sign and verify the rows. Pure apart from key derivation; never returns a key. */
export async function buildDestinations({ mnemonic, merchantId, chains, count }) {
  if (!mnemonic || mnemonic.trim().split(/\s+/).length < 12) throw new Error("PILOT_DESTINATION_MNEMONIC must be a 12+ word mnemonic you control");
  const rows = [];
  for (let i = 0; i < count; i++) {
    const account = mnemonicToAccount(mnemonic.trim(), { addressIndex: i });
    for (const chain of chains) {
      const custodyReference = `pilot-mnemonic m/44'/60'/0'/0/${i}`;
      const message = registrationMessage(merchantId, chain, account.address, custodyReference);
      const signature = await account.signMessage({ message });
      if (!(await verifyMessage({ address: account.address, message, signature }))) throw new Error("signature did not verify");
      rows.push({ merchant_id: merchantId, chain, address: account.address, custody_reference: custodyReference, approved_at: new Date().toISOString(), signature });
    }
  }
  return rows;
}

async function insertRows(rows, env) {
  const values = rows.map(({ signature: _s, ...r }) => r);
  if (env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: env.DATABASE_URL });
    await client.connect();
    let inserted = 0;
    try {
      for (const r of values) {
        const res = await client.query(
          "insert into merchant_payment_destinations(merchant_id,chain,address,custody_reference,approved_at) values($1,$2,$3,$4,$5) on conflict do nothing",
          [r.merchant_id, r.chain, r.address, r.custody_reference, r.approved_at]);
        inserted += res.rowCount;
      }
    } finally { await client.end(); }
    return inserted;
  }
  // Row by row: the duplicate guard is a unique EXPRESSION index (chain, lower(address)),
  // which PostgREST's ignore-duplicates cannot target, so a 409 means "already registered".
  let inserted = 0;
  for (const r of values) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/merchant_payment_destinations`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(r),
    });
    if (res.status === 409) continue;
    if (!res.ok) throw new Error(`insert failed: ${res.status} ${await res.text()}`);
    inserted++;
  }
  return inserted;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertNotProduction(process.env);
  const rows = await buildDestinations({ mnemonic: process.env.PILOT_DESTINATION_MNEMONIC, ...args });
  console.log(`merchant ${args.merchantId}: ${rows.length} signed registrations (${args.count} addresses x ${args.chains.join(", ")})`);
  for (const r of rows) console.log(`  ${r.chain.padEnd(9)} ${r.address}  ${r.custody_reference}`);
  if (args.dryRun) { console.log("dry run: nothing inserted"); return; }
  const inserted = await insertRows(rows, process.env);
  console.log(`inserted ${inserted} new destination(s); ${rows.length - inserted} already registered`);
  console.log("WARNING: these are MAINNET addresses. Real USDC sent to them is controlled by your mnemonic.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(`seed-pilot-destinations: ${e.message}`); process.exit(1); });
}
