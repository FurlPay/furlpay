import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Deploys the programmable-compliance guardrail (PolicyWrapper + PolicyManager +
// modular checks + AttestationRegistry + ComplianceEscrow) and wires it up.
//
// SECURITY POSTURE on live networks: the wrapper and escrow are deployed and
// then PAUSED, and the escrow gets a low per-tx cap. Nothing can settle or
// custody funds until the owner unpauses after post-deploy verification.

// Canonical native USDC per chain.
//
// The Arc entries are the ERC-20 INTERFACE onto that chain's native gas
// balance, not a deployed token — a precompile-shaped address behind an
// EIP-1967 proxy, the same on mainnet and testnet. Verified on Arc mainnet
// 2026-09-25: decimals() -> 6, symbol() -> "USDC". Contracts must use the
// 6-decimal ERC-20 view; Arc's native view of the SAME balance is 18 decimals
// and mixing them over-scales by 10^12.
const USDC_BY_CHAIN: Record<number, string> = {
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum One
  421614: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", // Arbitrum Sepolia
  5042: "0x3600000000000000000000000000000000000000", // Circle Arc mainnet
  5042002: "0x3600000000000000000000000000000000000000", // Circle Arc testnet
};

// Chainalysis on-chain Sanctions Oracle. Same address on the chains where it is
// deployed; absent on testnets (SanctionsCheck tolerates a zero/absent oracle).
const CHAINALYSIS_ORACLE = "0x40C57923924B5c5c5455c48D93317139ADDaC8fb";
const ORACLE_BY_CHAIN: Record<number, string> = {
  42161: CHAINALYSIS_ORACLE,
  // 421614 (Sepolia): none deployed → address(0), registry-only screening.
  //
  // ARC (5042 / 5042002): DELIBERATELY ABSENT, and this is a compliance fact
  // rather than an oversight. Checked on Arc mainnet 2026-09-25:
  //
  //   eth_getCode(0x40C5…c8fb) on Arc          -> "0x"     (no contract)
  //   eth_getCode(0x40C5…c8fb) on Arbitrum One -> 7116 hex chars (deployed)
  //
  // Chainalysis has not deployed its Sanctions Oracle to Arc. SanctionsCheck
  // tolerates a zero oracle and falls back to REGISTRY-ONLY screening, so a
  // deploy here succeeds and screens LESS than the same contract on Arbitrum —
  // silently, because nothing in the deploy output would say so.
  //
  // Naming Arc here with no oracle makes that explicit. Before enabling Arc
  // settlement for regulated flows, either confirm Chainalysis has deployed to
  // Arc and add the address, or accept registry-only screening in writing.
};

const USDC = (n: string) => ethers.parseUnits(n, 6);

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const usdc = process.env.USDC_ADDRESS || USDC_BY_CHAIN[chainId];
  if (!usdc) throw new Error(`No USDC address for chainId ${chainId} — set USDC_ADDRESS`);

  const owner = process.env.COMPLIANCE_OWNER || deployer.address;
  const attestor = process.env.COMPLIANCE_ATTESTOR || deployer.address;
  const oracle = process.env.SANCTIONS_ORACLE || ORACLE_BY_CHAIN[chainId] || ethers.ZeroAddress;
  const sofThreshold = process.env.SOF_THRESHOLD_USDC
    ? USDC(process.env.SOF_THRESHOLD_USDC)
    : USDC("1000");
  const escrowCap = process.env.ESCROW_CAP_USDC ? USDC(process.env.ESCROW_CAP_USDC) : USDC("100");
  const isLive = network.name !== "hardhat" && network.name !== "localhost";

  console.log(`Deploying compliance stack to ${network.name} (chainId ${chainId})`);
  console.log(`  deployer:  ${deployer.address}`);
  console.log(`  owner:     ${owner}`);
  console.log(`  usdc:      ${usdc}`);
  console.log(`  oracle:    ${oracle === ethers.ZeroAddress ? "(none — registry only)" : oracle}`);
  console.log(`  SoF thr:   ${ethers.formatUnits(sofThreshold, 6)} USDC`);
  console.log(`  escrowCap: ${ethers.formatUnits(escrowCap, 6)} USDC\n`);

  // Deploy under the deployer, then hand ownership to `owner` at the end so the
  // wiring calls below (onlyOwner) succeed.
  const registry = await ethers.deployContract("SanctionsRegistry", [deployer.address]);
  await registry.waitForDeployment();
  const attestations = await ethers.deployContract("AttestationRegistry", [deployer.address]);
  await attestations.waitForDeployment();

  const sanctionsCheck = await ethers.deployContract("SanctionsCheck", [
    deployer.address, oracle, await registry.getAddress(),
  ]);
  await sanctionsCheck.waitForDeployment();
  const sofCheck = await ethers.deployContract("SourceOfFundsCheck", [
    deployer.address, await attestations.getAddress(), sofThreshold,
  ]);
  await sofCheck.waitForDeployment();

  const policyManager = await ethers.deployContract("PolicyManager", [deployer.address]);
  await policyManager.waitForDeployment();
  await (await policyManager.addCheck(await sanctionsCheck.getAddress())).wait();
  await (await policyManager.addCheck(await sofCheck.getAddress())).wait();

  const escrow = await ethers.deployContract("ComplianceEscrow", [
    usdc, await attestations.getAddress(), deployer.address,
  ]);
  await escrow.waitForDeployment();
  const wrapper = await ethers.deployContract("X402PolicyWrapper", [
    usdc, await policyManager.getAddress(), await attestations.getAddress(), await escrow.getAddress(), deployer.address,
  ]);
  await wrapper.waitForDeployment();

  // --- Wiring --------------------------------------------------------------
  await (await escrow.setWrapper(await wrapper.getAddress())).wait();
  await (await escrow.setPerTxCap(escrowCap)).wait();
  await (await attestations.setWriter(await wrapper.getAddress(), true)).wait();
  await (await attestations.setWriter(await escrow.getAddress(), true)).wait();
  await (await attestations.setAttestor(attestor, true)).wait();
  // The OFAC seed job (seed-sanctions.ts) runs under the deployer/updater key.
  await (await registry.setUpdater(deployer.address, true)).wait();

  // --- Safe posture on live networks: pause until verified -----------------
  if (isLive) {
    await (await escrow.pause()).wait();
    await (await wrapper.pause()).wait();
    console.log("Deployed PAUSED (escrow + wrapper). Unpause after verification.\n");
  }

  // --- Hand over ownership if a distinct owner was requested ---------------
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    for (const c of [registry, attestations, sanctionsCheck, sofCheck, policyManager, escrow, wrapper]) {
      await (await (c as any).transferOwnership(owner)).wait();
    }
    console.log(`Ownership transfer initiated to ${owner} (Ownable2Step — owner must accept).\n`);
  }

  const addrs = {
    SanctionsRegistry: await registry.getAddress(),
    AttestationRegistry: await attestations.getAddress(),
    SanctionsCheck: await sanctionsCheck.getAddress(),
    SourceOfFundsCheck: await sofCheck.getAddress(),
    PolicyManager: await policyManager.getAddress(),
    ComplianceEscrow: await escrow.getAddress(),
    X402PolicyWrapper: await wrapper.getAddress(),
  };

  const record = {
    network: network.name,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    owner,
    attestor,
    usdc,
    oracle,
    sofThreshold: sofThreshold.toString(),
    escrowCap: escrowCap.toString(),
    paused: isLive,
    contracts: addrs,
  };
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `compliance.${network.name}.json`), JSON.stringify(record, null, 2));
  console.log(`Deployment record: deployments/compliance.${network.name}.json\n`);

  console.log("Set these in apps/web (.env.local / Vercel):");
  console.log(`FURLPAY_POLICY_WRAPPER_ADDRESS=${addrs.X402PolicyWrapper}`);
  console.log(`FURLPAY_POLICY_MANAGER_ADDRESS=${addrs.PolicyManager}`);
  console.log(`FURLPAY_ATTESTATION_REGISTRY_ADDRESS=${addrs.AttestationRegistry}`);
  console.log(`FURLPAY_SANCTIONS_REGISTRY_ADDRESS=${addrs.SanctionsRegistry}`);
  console.log(`FURLPAY_COMPLIANCE_ESCROW_ADDRESS=${addrs.ComplianceEscrow}`);
  console.log(`FURLPAY_SANCTIONS_CHECK_ADDRESS=${addrs.SanctionsCheck}`);
  console.log(`FURLPAY_SOF_CHECK_ADDRESS=${addrs.SourceOfFundsCheck}`);

  if (isLive) {
    console.log("\nNext:");
    console.log("  1) npx hardhat run scripts/seed-sanctions.ts --network " + network.name);
    console.log("  2) Verify screening + evaluate() reads, then unpause:");
    console.log(`     escrow.unpause() and wrapper.unpause() from the owner key.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
