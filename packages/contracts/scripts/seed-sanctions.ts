import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Seeds SanctionsRegistry from the public OFAC SDN crypto-address list. Uses the
// community-maintained, OFAC-derived dataset published by 0xB10C (the same SDN
// entries the Treasury publishes, parsed into per-asset address lists). The
// registry supplements the Chainalysis oracle so screening still works where the
// oracle is absent and so freshly-listed addresses can be added immediately.
//
//   npx hardhat run scripts/seed-sanctions.ts --network arbitrumOne
//
// Idempotent (setting an address sanctioned twice is a no-op on state). Set
// SEED_LIMIT to cap how many addresses are written (useful to bound gas).

const SDN_ETH_LIST =
  process.env.SDN_LIST_URL ||
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt";

const BATCH_SIZE = Number(process.env.SEED_BATCH_SIZE || 150);

function resolveRegistry(): string {
  if (process.env.FURLPAY_SANCTIONS_REGISTRY_ADDRESS) return process.env.FURLPAY_SANCTIONS_REGISTRY_ADDRESS;
  const rec = path.join(__dirname, "..", "deployments", `compliance.${network.name}.json`);
  if (fs.existsSync(rec)) {
    const parsed = JSON.parse(fs.readFileSync(rec, "utf8"));
    return parsed.contracts.SanctionsRegistry;
  }
  throw new Error("No SanctionsRegistry address — set FURLPAY_SANCTIONS_REGISTRY_ADDRESS or run deploy-compliance first");
}

async function main() {
  const registryAddr = resolveRegistry();
  console.log(`Seeding SanctionsRegistry ${registryAddr} on ${network.name}`);
  console.log(`Source: ${SDN_ETH_LIST}\n`);

  const res = await fetch(SDN_ETH_LIST);
  if (!res.ok) throw new Error(`Failed to fetch SDN list: ${res.status} ${res.statusText}`);
  const text = await res.text();

  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const a = line.trim();
    if (!ethers.isAddress(a)) continue;
    const norm = ethers.getAddress(a);
    if (seen.has(norm)) continue;
    seen.add(norm);
    addresses.push(norm);
  }
  const limit = process.env.SEED_LIMIT ? Number(process.env.SEED_LIMIT) : addresses.length;
  const toSeed = addresses.slice(0, limit);
  console.log(`Parsed ${addresses.length} unique OFAC SDN ETH addresses; seeding ${toSeed.length}.\n`);

  const registry = await ethers.getContractAt("SanctionsRegistry", registryAddr);

  let written = 0;
  for (let i = 0; i < toSeed.length; i += BATCH_SIZE) {
    const batch = toSeed.slice(i, i + BATCH_SIZE);
    const tx = await registry.setSanctionedBatch(batch, true);
    await tx.wait();
    written += batch.length;
    console.log(`  batch ${i / BATCH_SIZE + 1}: +${batch.length} (${written}/${toSeed.length})  tx ${tx.hash}`);
  }
  console.log(`\nDone. ${written} addresses marked sanctioned in the registry.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
