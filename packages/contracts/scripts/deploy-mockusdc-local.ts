import { ethers, network } from "hardhat";

// Deploys MockUSDC (EIP-3009-compatible test USDC) to a local node and funds
// the payer account for the x402 live-settlement end-to-end drive. Pairs with
// hardhat.config.local3009.ts (chainId 421614 = arbitrum-sepolia).
const USDC = (n: string) => ethers.parseUnits(n, 6);

async function main() {
  const [feePayer, payer, treasury] = await ethers.getSigners();

  const usdc = await ethers.deployContract("MockUSDC");
  await usdc.waitForDeployment();
  await (await usdc.mint(payer.address, USDC("1000"))).wait();

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log(JSON.stringify({
    network: network.name,
    chainId,
    usdc: await usdc.getAddress(),
    feePayer: feePayer.address,
    payer: payer.address,
    treasury: treasury.address,
    payerBalance: ethers.formatUnits(await usdc.balanceOf(payer.address), 6),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
