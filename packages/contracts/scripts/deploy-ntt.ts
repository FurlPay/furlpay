import { ethers } from "hardhat";

/**
 * FURL EVM spoke deployment — DRY RUN BY DEFAULT.
 *
 *   npx hardhat run scripts/deploy-ntt.ts --network arbitrum            # plan only
 *   npx hardhat run scripts/deploy-ntt.ts --network arbitrum --execute  # deploys
 *
 * WHAT THIS DEPLOYS: the CanonicalFURL ERC-20 for one spoke chain, and nothing
 * else. It deliberately does NOT deploy the NttManager or the transceiver, and
 * does not grant MINTER_ROLE.
 *
 * WHY NOT. Granting MINTER_ROLE is the act that makes unbacked supply possible,
 * and it should be a separate, deliberate transaction made against a manager
 * address someone has verified — not a step buried in a deployment script that
 * also did five other things. The NTT contracts are deployed by Wormhole's own
 * CLI (a curl-installed binary, see deployment.yaml), which owns their wiring,
 * peer configuration and rate limits. A script that reimplemented that wiring
 * would be a second source of truth for the most security-sensitive part of the
 * bridge.
 *
 * So the order is: deploy the token here → deploy NTT with `ntt add-chain` →
 * verify the manager address → grant MINTER_ROLE in its own reviewed
 * transaction.
 *
 * ── CORRECTIONS TO THE SOURCE PLAN, VERIFIED 2026-09-13 ────────────────────
 *
 * 1. "FURL's mint authority is permanently revoked on Solana" — FALSE. It is
 *    ACTIVE at FgeSXvrWcqE93byDoF3Vhwou7XTUhY42cYhs7vXkJPUL; the revocation
 *    script is prepared and unrun. Burn-and-mint on Solana is therefore
 *    available, not impossible. Hub-and-spoke is still chosen, on the merits
 *    recorded in deployment.yaml — chiefly that burning mode would hand mint
 *    authority to bridge infrastructure while the keep-or-revoke decision is
 *    still open.
 *
 * 2. "Eclipse — identical Token-2022 bytecode, zero bridging needed" — FALSE.
 *    Eclipse runs the SVM but is a separate chain with its own state. FURL
 *    there would be a NEW mint with its own supply and its own address, and it
 *    would need bridging exactly like any other spoke. "Same bytecode" is not
 *    "same token"; treating it as one would create a second unbacked 1B supply.
 *
 * 3. The NTT CLI install is a curl script. The plan said `cargo install --git`;
 *    a later correction said `npm install -g @wormhole-foundation/ntt-cli`.
 *    Both are wrong — that npm package 404s. See deployment.yaml.
 *
 * 4. "Grant BURNER_ROLE to NttManager" — there is no BURNER_ROLE. CanonicalFURL
 *    uses allowance-checked `burnFrom`, because a role that burns any holder's
 *    balance is a permanent delegate, an extension FURL deliberately omits on
 *    Solana. The manager takes custody with `transferFrom` and burns its own
 *    balance with `burn()`.
 */

interface SpokeConfig {
  chainId: number;
  mode: string;
}

const RULE = "─".repeat(74);

/** Chains this script will deploy a spoke on, from deployment.yaml. */
const SUPPORTED: Record<string, SpokeConfig> = {
  arbitrumOne: { chainId: 42161, mode: "burning" },
  base: { chainId: 8453, mode: "burning" },
  arbitrumSepolia: { chainId: 421614, mode: "burning" },
  baseSepolia: { chainId: 84532, mode: "burning" },
};

/** Seconds a pending DEFAULT_ADMIN_ROLE handover must wait before acceptance. */
const ADMIN_TRANSFER_DELAY = 3 * 24 * 60 * 60;

/** 1e9 FURL at 6 decimals. Must equal CanonicalFURL.MAX_SUPPLY. */
const EXPECTED_MAX_SUPPLY = 1_000_000_000n * 10n ** 6n;

async function main() {
  const execute = process.argv.includes("--execute");
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const entry = Object.entries(SUPPORTED).find(([, c]) => c.chainId === chainId);
  if (!entry) {
    throw new Error(
      `Chain ${chainId} is not a configured FURL spoke. Supported: ${Object.values(SUPPORTED)
        .map((c) => c.chainId)
        .join(", ")}`,
    );
  }
  const [chainName, spoke] = entry;

  // No DEPLOYER_PRIVATE_KEY configured means getSigners() is empty. A DRY RUN
  // must still work in that state — the whole point of planning is to do it
  // before a funded key exists, and crashing here would make the script useless
  // until the moment it becomes dangerous.
  const signers = await ethers.getSigners();
  const deployer = signers[0] ?? null;
  const balance = deployer ? await ethers.provider.getBalance(deployer.address) : 0n;

  console.log("FURL EVM spoke deployment");
  console.log(RULE);
  console.log(`chain        ${chainName} (${chainId})`);
  console.log(`mode         ${spoke.mode}`);
  console.log(`deployer     ${deployer?.address ?? "(none — DEPLOYER_PRIVATE_KEY unset)"}`);
  console.log(`balance      ${ethers.formatEther(balance)} ETH`);
  console.log(`admin delay  ${ADMIN_TRANSFER_DELAY}s (${ADMIN_TRANSFER_DELAY / 86400} days)`);
  console.log("");

  // ---- the admin decision, surfaced before anything is signed --------------
  const admin = process.env.FURL_EVM_ADMIN;
  console.log("ADMIN");
  if (!admin) {
    console.log("  FURL_EVM_ADMIN is not set.");
    console.log("  This address receives DEFAULT_ADMIN_ROLE, which can grant MINTER_ROLE —");
    console.log("  the power to create FURL supply on this chain. It MUST be a multisig,");
    console.log("  never an EOA, and never the deployer key by default.");
  } else {
    console.log(`  ${admin}`);
    if (deployer && admin.toLowerCase() === deployer.address.toLowerCase()) {
      console.log("  WARNING: admin equals the deployer EOA. One key would hold both the");
      console.log("  deployment key and the power to grant minting. Use a multisig.");
    }
  }
  console.log("");

  // ---- what would be deployed ---------------------------------------------
  console.log("PLAN");
  console.log("  1. Deploy CanonicalFURL(admin, adminTransferDelay)");
  console.log("     - name FurlPay, symbol FURL, decimals 6");
  console.log(`     - MAX_SUPPLY ${EXPECTED_MAX_SUPPLY} base units (1,000,000,000 FURL)`);
  console.log("     - no MINTER_ROLE granted; supply is 0 and cannot be minted yet");
  console.log("");
  console.log("  NOT done by this script, deliberately:");
  console.log("  2. NttManager + WormholeTransceiver  -> Wormhole's `ntt add-chain`");
  console.log("  3. Peer wiring and rate limits       -> `ntt set-peer` / `ntt set-rate-limit`");
  console.log("  4. grantRole(MINTER_ROLE, nttManager) -> its own reviewed transaction,");
  console.log("     after the manager address has been verified on chain");
  console.log("");

  // ---- blockers ------------------------------------------------------------
  const blockers: string[] = [];
  if (!deployer) blockers.push("no deployer key configured (DEPLOYER_PRIVATE_KEY unset)");
  if (!admin) blockers.push("FURL_EVM_ADMIN is unset");
  if (deployer && balance === 0n) blockers.push("deployer has no native balance for gas");
  if (chainId === 42161 || chainId === 8453) {
    blockers.push(
      "MAINNET: the Solana treasury migration has not happened — 100% of supply is " +
        "still under one key, and bridging first multiplies that exposure across chains",
    );
  }

  if (blockers.length) {
    console.log("BLOCKERS");
    for (const b of blockers) console.log(`  - ${b}`);
    console.log("");
  }

  if (!execute) {
    console.log("DRY RUN — nothing was deployed. No transaction was signed.");
    console.log("Pass --execute to deploy, once the blockers above are cleared.");
    return;
  }

  // ---- execution -----------------------------------------------------------
  if (blockers.length) {
    throw new Error(`Refusing to execute with ${blockers.length} blocker(s):\n  - ${blockers.join("\n  - ")}`);
  }

  const Factory = await ethers.getContractFactory("CanonicalFURL");
  const token = await Factory.deploy(admin as string, ADMIN_TRANSFER_DELAY);
  await token.waitForDeployment();
  const address = await token.getAddress();

  console.log(`Deployed CanonicalFURL at ${address}`);

  // Postconditions. A deployment that silently produced the wrong decimals or a
  // missing cap is worse than a failed one, because it looks finished.
  const [decimals, maxSupply, supply] = await Promise.all([
    token.decimals(),
    token.MAX_SUPPLY(),
    token.totalSupply(),
  ]);

  if (Number(decimals) !== 6) throw new Error(`decimals is ${decimals}, expected 6`);
  if (maxSupply !== EXPECTED_MAX_SUPPLY) {
    throw new Error(`MAX_SUPPLY is ${maxSupply}, expected ${EXPECTED_MAX_SUPPLY}`);
  }
  if (supply !== 0n) throw new Error(`totalSupply is ${supply}, expected 0`);

  console.log("  decimals    6              ✓");
  console.log(`  MAX_SUPPLY  ${maxSupply}   ✓`);
  console.log("  totalSupply 0              ✓ (nothing mintable until MINTER_ROLE is granted)");
  console.log("");
  console.log("NEXT, as separate reviewed steps:");
  console.log(`  ntt add-chain ${chainName} --mode burning --token ${address}`);
  console.log("  verify the NttManager address on the block explorer");
  console.log("  grantRole(MINTER_ROLE, <nttManager>) from the admin multisig");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
