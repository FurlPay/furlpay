import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Deploy FurlPayRouter to Circle Arc. ONE CONTRACT.
//
// WHY THIS IS NOT scripts/deploy.ts. That script deploys FurlPayRouter,
// X402Facilitator, FurlPayEscrow and BookingReceipt together, and defaults every
// owner to the deployer's own address. Both are wrong for Arc:
//
//   * Only FurlPayRouter has a wired consumer (lib/services/payments.ts builds
//     the EIP-712 domain with it as verifyingContract). The other three would be
//     deployed because they exist — each one an owner key to protect, an audit
//     surface to widen, and an invitation for a future caller to use a contract
//     nobody reviewed for that use. See docs/ARC-DEPLOYMENT-ARCHITECTURE.md.
//   * Owner-defaults-to-deployer collapses two very different keys. The deployer
//     key exists to send one transaction; the owner key can redirect every fee
//     and pause the rail. Separating them afterwards is an extra transaction
//     someone will skip, so this script refuses to start without both.
//
// EVERY PRE-FLIGHT BELOW IS A FINDING FROM docs/ARC-SECURITY-REVIEW.md. None is
// generic deployment hygiene; each one is a specific way an Arc deployment goes
// wrong in a way that is hard to see afterwards. The script refuses rather than
// warns, because a warning printed above 40 lines of deployment output is not a
// control.
// ---------------------------------------------------------------------------

const ARC_MAINNET = 5042;
const ARC_TESTNET = 5042002;

/** The ERC-20 interface onto Arc's native USDC. Identical on both networks. */
const ARC_USDC = "0x3600000000000000000000000000000000000000";

/** Arc's minimum base fee. Below this a transaction is DROPPED with no receipt. */
const ARC_MIN_BASE_FEE_WEI = 20_000_000_000n;

/** Arc's published testnet address that reads as blocklisted. */
const ARC_TESTNET_BLOCKED_TEST_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

function fail(message: string): never {
  console.error(`\n  REFUSING TO DEPLOY\n\n  ${message}\n`);
  process.exit(1);
}

/** `isBlacklisted(address)` on Circle FiatTokenV2. Verified present on Arc. */
async function isBlacklisted(usdc: string, address: string): Promise<boolean> {
  const data = ethers.concat([
    "0xfe575a87",
    ethers.zeroPadValue(ethers.getAddress(address), 32),
  ]);
  const raw = await ethers.provider.call({ to: usdc, data });

  // Fail closed. An empty or non-boolean answer is not "not blocked" — we have
  // measured that this function exists on both Arc networks, so an unusable
  // answer means we are not talking to Arc's USDC and must not proceed.
  if (!raw || raw === "0x") {
    fail(
      `isBlacklisted(${address}) returned no data from ${usdc}.\n` +
        `  Arc's USDC implements it (verified on mainnet and testnet), so either\n` +
        `  this RPC is not Arc or that address is not USDC on it. Not assuming clear.`
    );
  }
  const value = BigInt(raw);
  if (value !== 0n && value !== 1n) {
    fail(`isBlacklisted(${address}) returned ${value}, which is not a boolean. Not guessing.`);
  }
  return value === 1n;
}

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const isMainnet = chainId === ARC_MAINNET;

  console.log(`\nFurlPayRouter -> ${network.name} (chainId ${chainId})\n`);

  // --- 1. The right chain ---------------------------------------------------
  if (chainId !== ARC_MAINNET && chainId !== ARC_TESTNET) {
    fail(
      `chainId ${chainId} is neither Arc mainnet (${ARC_MAINNET}) nor Arc testnet\n` +
        `  (${ARC_TESTNET}). This script is Arc-only — use scripts/deploy.ts for\n` +
        `  other networks. Did you forget --network arcTestnet?`
    );
  }

  // --- 2. Mainnet needs to be asked for, explicitly ------------------------
  // The failure this prevents: running the intended testnet command with the
  // wrong --network and deploying to mainnet by accident. Hardhat already uses a
  // separate key for arcMainnet, so that deploy would fail for want of an
  // account — but only by luck, and only until someone sets both keys.
  if (isMainnet && process.env.ARC_MAINNET_DEPLOY_CONFIRMED !== "yes") {
    fail(
      `This is ARC MAINNET (${ARC_MAINNET}). Real money.\n\n` +
        `  Before setting ARC_MAINNET_DEPLOY_CONFIRMED=yes, every item in\n` +
        `  docs/ARC-PRODUCTION-READINESS.md must be checked — including a\n` +
        `  third-party audit, which does not exist yet.\n\n` +
        `  Deploy to testnet first:  npx hardhat run scripts/deploy-arc.ts --network arcTestnet`
    );
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    fail(
      `No signer. Set ${isMainnet ? "ARC_MAINNET_DEPLOYER_PRIVATE_KEY" : "DEPLOYER_PRIVATE_KEY"}.`
    );
  }

  // --- 3. Owner and treasury must be named, and must not be the deployer ---
  const owner = process.env.ARC_ROUTER_OWNER;
  const treasury = process.env.ARC_FEE_TREASURY;

  if (!owner || !treasury) {
    fail(
      `ARC_ROUTER_OWNER and ARC_FEE_TREASURY must both be set.\n\n` +
        `  Neither defaults to the deployer, deliberately. The deployer key sends\n` +
        `  one transaction; the owner key can redirect every fee and pause the\n` +
        `  rail. Conflating them means the throwaway key is also the production one.`
    );
  }

  const ownerAddr = ethers.getAddress(owner);
  const treasuryAddr = ethers.getAddress(treasury);

  if (ownerAddr === deployer.address) {
    fail(
      `ARC_ROUTER_OWNER is the deployer (${deployer.address}).\n` +
        `  Use a separate, custodied address — see above.`
    );
  }

  // --- 4. Verify USDC rather than trusting the constant --------------------
  // A wrong token address here is unrecoverable: the router is immutable in
  // `usdc`, so it would have to be redeployed. Cheap to check, so it is checked.
  const usdc = process.env.USDC_ADDRESS ? ethers.getAddress(process.env.USDC_ADDRESS) : ARC_USDC;
  const erc20 = new ethers.Contract(
    usdc,
    ["function decimals() view returns (uint8)", "function symbol() view returns (string)"],
    ethers.provider
  );

  let decimals: number;
  let symbol: string;
  try {
    decimals = Number(await erc20.decimals());
    symbol = String(await erc20.symbol());
  } catch (e) {
    fail(`${usdc} did not answer decimals()/symbol(). It is not an ERC-20 on this chain.`);
  }

  // 6, NOT 18. Arc's native interface is 18 decimals and its ERC-20 interface is
  // 6, over one balance. The router moves USDC through the ERC-20 interface, so
  // 6 is correct here — and reading 18 would mean we are pointed at the native
  // view and every amount would be mis-scaled by 10^12.
  if (decimals !== 6) {
    fail(
      `${usdc} reports decimals() == ${decimals}, expected 6.\n` +
        `  Arc's ERC-20 USDC interface is 6dp; its NATIVE view is 18dp. The router\n` +
        `  works in ERC-20 units, so 18 here would mis-scale every amount by 10^12.`
    );
  }
  if (symbol !== "USDC") {
    fail(`${usdc} reports symbol() == "${symbol}", expected "USDC".`);
  }

  // --- 5. Screen owner and treasury (finding R6) ---------------------------
  // A blocklisted treasury is a TOTAL OUTAGE of the fee-bearing path: every
  // payment with fee > 0 reverts. Deploying into that state would present as
  // "the rail never worked", which is a bad thing to debug from cold.
  for (const [role, address] of [
    ["fee treasury", treasuryAddr],
    ["owner", ownerAddr],
    ["deployer", deployer.address],
  ] as const) {
    if (await isBlacklisted(usdc, address)) {
      fail(
        `The ${role} (${address}) is BLOCKLISTED by Circle's USDC on Arc.\n` +
          `  Transfers to or from it revert on-chain. Use a different address.`
      );
    }
  }

  // --- 6. Gas is USDC, and there is a floor -------------------------------
  const balance = await ethers.provider.getBalance(deployer.address);
  if (balance === 0n) {
    fail(
      `Deployer ${deployer.address} has a zero balance.\n\n` +
        `  ON ARC, GAS IS USDC — not ETH. A key funded with ETH has nothing to pay\n` +
        `  with and every transaction fails at estimation.\n` +
        `  ${isMainnet ? "Fund it with USDC on Arc mainnet." : "Testnet faucet: https://faucet.circle.com"}`
    );
  }

  // The floor is the one Arc failure with NO signal: below 20 Gwei a transaction
  // is dropped silently, with no receipt and no error, which is indistinguishable
  // from pending. Checked before submitting, because afterwards there is nothing
  // to observe.
  const feeData = await ethers.provider.getFeeData();
  const maxFee = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  if (maxFee < ARC_MIN_BASE_FEE_WEI) {
    fail(
      `The provider offers maxFeePerGas ${maxFee} wei, below Arc's minimum base\n` +
        `  fee of ${ARC_MIN_BASE_FEE_WEI} (20 Gwei). Arc DROPS such a transaction\n` +
        `  silently — no receipt, no error — so this deployment would appear to hang\n` +
        `  forever rather than fail. Raise the fee explicitly.`
    );
  }

  // Denominated in dollars, because the gas asset is USDC at 18 decimals.
  const balanceUsd = ethers.formatUnits(balance, 18);

  console.log(`  deployer:  ${deployer.address}`);
  console.log(`  balance:   ${balanceUsd} USDC  (gas is USDC on Arc)`);
  console.log(`  maxFee:    ${ethers.formatUnits(maxFee, 9)} Gwei  (floor 20)`);
  console.log(`  usdc:      ${usdc}  decimals=${decimals} symbol=${symbol}`);
  console.log(`  owner:     ${ownerAddr}`);
  console.log(`  treasury:  ${treasuryAddr}`);
  console.log(`  screened:  owner, treasury and deployer all clear\n`);

  // --- 7. Deploy -----------------------------------------------------------
  const router = await ethers.deployContract("FurlPayRouter", [usdc, treasuryAddr, ownerAddr]);
  const tx = router.deploymentTransaction();
  await router.waitForDeployment();
  const address = await router.getAddress();
  const receipt = tx ? await tx.wait() : null;

  // A reverted deployment still produces a receipt on Arc, and a receipt is not
  // proof of success. Checked rather than assumed.
  if (receipt && receipt.status !== 1) {
    fail(`Deployment transaction ${tx?.hash} was mined but REVERTED (status ${receipt.status}).`);
  }

  console.log(`  FurlPayRouter: ${address}`);
  console.log(`  tx:            ${tx?.hash}`);
  console.log(`  block:         ${receipt?.blockNumber}`);
  console.log(`  gas used:      ${receipt?.gasUsed}`);

  // --- 8. Verify the deployed state, from the chain ------------------------
  // Constructor arguments are easy to transpose and the router's `usdc` is
  // immutable, so confirm what actually landed rather than what we intended.
  const onChainUsdc = ethers.getAddress(await router.usdc());
  const onChainOwner = ethers.getAddress(await router.owner());
  const onChainTreasury = ethers.getAddress(await router.feeTreasury());

  if (onChainUsdc !== usdc || onChainOwner !== ownerAddr || onChainTreasury !== treasuryAddr) {
    fail(
      `Deployed state does not match what was requested:\n` +
        `    usdc     on-chain ${onChainUsdc}   expected ${usdc}\n` +
        `    owner    on-chain ${onChainOwner}  expected ${ownerAddr}\n` +
        `    treasury on-chain ${onChainTreasury} expected ${treasuryAddr}\n` +
        `  The contract at ${address} must NOT be used.`
    );
  }

  console.log(`  verified:      usdc, owner and feeTreasury read back correctly\n`);

  // --- 9. Record it ---------------------------------------------------------
  // An unrecorded address is a lost address. Written as JSON next to the code
  // rather than pasted into a chat.
  const out = {
    network: network.name,
    chainId,
    contract: "FurlPayRouter",
    address,
    txHash: tx?.hash ?? null,
    blockNumber: receipt?.blockNumber ?? null,
    gasUsed: receipt?.gasUsed?.toString() ?? null,
    constructorArgs: { usdc, feeTreasury: treasuryAddr, owner: ownerAddr },
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    // Recorded so a later reader is not left to infer the deployment's standing.
    audited: false,
    notes: "Reviewed in docs/ARC-SECURITY-REVIEW.md by its authors. NOT third-party audited.",
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `arc-${chainId}.json`);
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`  recorded:      ${path.relative(process.cwd(), file)}`);

  // --- 10. What is still not done -----------------------------------------
  console.log(`\n  NEXT — deployment is not the same as being usable:\n`);
  console.log(`   1. Set FURLPAY_ROUTER_ADDRESS=${address} in the app env.`);
  console.log(`      Until then lib/services/payments.ts fails closed, by design.`);
  if (!isMainnet) {
    console.log(`   2. Exercise a real pay() end to end.`);
    console.log(`   3. Exercise a BLOCKLIST REVERT using Arc's published test address`);
    console.log(`      ${ARC_TESTNET_BLOCKED_TEST_ADDRESS} — the only way to`);
    console.log(`      test that path without involving a real sanctioned party.`);
    console.log(`   4. Confirm receipt.status is checked on the failure, not just inclusion.`);
  }
  console.log(`   5. Findings R7 and R8 in docs/ARC-SECURITY-REVIEW.md are still OPEN.`);
  console.log(`      Arc settlement is not safe to enable until both are fixed.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
