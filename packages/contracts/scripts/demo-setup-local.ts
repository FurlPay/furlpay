import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Local demo setup: deploys MockUSDC + the full compliance stack to a local
// node, wires it, funds the buyer, and writes a deployment record the agent
// demo reads. For local end-to-end validation only (real USDC on mainnet).
//
//   npx hardhat node                                   # terminal 1
//   npx hardhat run scripts/demo-setup-local.ts --network localhost
//   npm run demo:compliance --workspace @furlpay/agent # (agent) terminal 2

const USDC = (n: string) => ethers.parseUnits(n, 6);

async function main() {
  const [deployer, buyer, seller] = await ethers.getSigners();

  const usdc = await ethers.deployContract("MockUSDC");
  await usdc.waitForDeployment();

  const registry = await ethers.deployContract("SanctionsRegistry", [deployer.address]);
  const attestations = await ethers.deployContract("AttestationRegistry", [deployer.address]);
  const sanctionsCheck = await ethers.deployContract("SanctionsCheck", [
    deployer.address, ethers.ZeroAddress, await registry.getAddress(),
  ]);
  const sofCheck = await ethers.deployContract("SourceOfFundsCheck", [
    deployer.address, await attestations.getAddress(), USDC("1000"),
  ]);
  const policyManager = await ethers.deployContract("PolicyManager", [deployer.address]);
  await (await policyManager.addCheck(await sanctionsCheck.getAddress())).wait();
  await (await policyManager.addCheck(await sofCheck.getAddress())).wait();
  const escrow = await ethers.deployContract("ComplianceEscrow", [
    await usdc.getAddress(), await attestations.getAddress(), deployer.address,
  ]);
  const wrapper = await ethers.deployContract("X402PolicyWrapper", [
    await usdc.getAddress(), await policyManager.getAddress(), await attestations.getAddress(),
    await escrow.getAddress(), deployer.address,
  ]);

  await (await escrow.setWrapper(await wrapper.getAddress())).wait();
  await (await escrow.setPerTxCap(USDC("1000000"))).wait();
  await (await attestations.setWriter(await wrapper.getAddress(), true)).wait();
  await (await attestations.setWriter(await escrow.getAddress(), true)).wait();
  await (await attestations.setAttestor(deployer.address, true)).wait();

  await (await usdc.mint(buyer.address, USDC("100000"))).wait();

  const record = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    usdc: await usdc.getAddress(),
    contracts: {
      SanctionsRegistry: await registry.getAddress(),
      AttestationRegistry: await attestations.getAddress(),
      PolicyManager: await policyManager.getAddress(),
      ComplianceEscrow: await escrow.getAddress(),
      X402PolicyWrapper: await wrapper.getAddress(),
    },
  };
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `compliance.${network.name}.local.json`), JSON.stringify(record, null, 2));
  // Also write the name the agent looks up by default.
  fs.writeFileSync(path.join(outDir, `compliance.${network.name}.json`), JSON.stringify(record, null, 2));

  console.log("Local compliance stack ready.");
  console.log(`  buyer (fund):  ${buyer.address}`);
  console.log(`  seller:        ${seller.address}`);
  console.log(`  PolicyWrapper: ${record.contracts.X402PolicyWrapper}`);
  console.log(`  USDC:          ${record.usdc}`);
  console.log(`  record:        deployments/compliance.${network.name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
