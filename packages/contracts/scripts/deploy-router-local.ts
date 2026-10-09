import { ethers, network } from "hardhat";

// LOCAL ONLY: MockUSDC + FurlPayRouter on an in-memory node, and 100,000 test
// USDC for the employer account. Refuses any chain that is not a local node, so
// it can never be pointed at a real network by mistake.
const USDC = (n: string) => ethers.parseUnits(n, 6);

async function main() {
  if (network.name !== "localhost" && network.name !== "hardhat") throw new Error(`refusing to deploy to ${network.name}: local nodes only`);
  const [deployer, employer, treasury] = await ethers.getSigners();
  const usdc = await ethers.deployContract("MockUSDC");
  await usdc.waitForDeployment();
  const router = await ethers.deployContract("FurlPayRouter", [await usdc.getAddress(), treasury.address, deployer.address]);
  await router.waitForDeployment();
  await (await usdc.mint(employer.address, USDC("100000"))).wait();
  console.log(JSON.stringify({
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    usdc: await usdc.getAddress(),
    router: await router.getAddress(),
    employer: employer.address,
    treasury: treasury.address,
  }));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
