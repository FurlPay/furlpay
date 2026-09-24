import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Canonical USDC per network (native Circle issuance).
//
// Arc entries are the ERC-20 INTERFACE onto the chain's native gas balance,
// not a deployed token contract — a precompile-shaped address behind an
// EIP-1967 proxy, identical on mainnet and testnet. Verified on Arc mainnet
// 2026-09-25: decimals() -> 6, symbol() -> "USDC".
//
// Any contract taking this address must use the 6-decimal ERC-20 view. Arc's
// NATIVE view of the same balance is 18 decimals; mixing them mis-scales by
// 10^12, and in this direction that means over-transferring by a trillion.
const USDC_BY_CHAIN: Record<number, string> = {
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum One
  421614: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", // Arbitrum Sepolia
  5042: "0x3600000000000000000000000000000000000000", // Circle Arc mainnet
  5042002: "0x3600000000000000000000000000000000000000", // Circle Arc testnet
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const usdc = process.env.USDC_ADDRESS || USDC_BY_CHAIN[chainId];
  if (!usdc) throw new Error(`No USDC address known for chainId ${chainId} — set USDC_ADDRESS`);

  const treasury = process.env.FEE_TREASURY || deployer.address;
  const oracle = process.env.CHECKIN_ORACLE || deployer.address;
  const receiptBaseURI =
    process.env.RECEIPT_BASE_URI || "https://furlpay.com/api/travel/bookings/receipt/";

  console.log(`Deploying to ${network.name} (chainId ${chainId})`);
  console.log(`  deployer: ${deployer.address}`);
  console.log(`  usdc:     ${usdc}`);
  console.log(`  treasury: ${treasury}\n`);

  const router = await ethers.deployContract("FurlPayRouter", [usdc, treasury, deployer.address]);
  await router.waitForDeployment();
  console.log(`FurlPayRouter:   ${await router.getAddress()}`);

  // Initial endorsed facilitator (the fee-payer EOA that submits settlements);
  // defaults to the deployer. Only this caller can create settlement records.
  const x402Facilitator = process.env.X402_FACILITATOR || deployer.address;
  const facilitator = await ethers.deployContract("X402Facilitator", [
    usdc,
    deployer.address,
    x402Facilitator,
  ]);
  await facilitator.waitForDeployment();
  console.log(`X402Facilitator: ${await facilitator.getAddress()}`);

  const receipt = await ethers.deployContract("BookingReceipt", [deployer.address, receiptBaseURI]);
  await receipt.waitForDeployment();
  console.log(`BookingReceipt:  ${await receipt.getAddress()}`);

  const escrow = await ethers.deployContract("FurlPayEscrow", [
    usdc,
    await receipt.getAddress(),
    oracle,
    deployer.address,
  ]);
  await escrow.waitForDeployment();
  console.log(`FurlPayEscrow:   ${await escrow.getAddress()}`);

  // Escrow mints receipts on booking creation.
  const tx = await receipt.setMinter(await escrow.getAddress());
  await tx.wait();
  console.log(`BookingReceipt.minter -> FurlPayEscrow\n`);

  // Persist the deployment record and print the env block the web app reads
  // (apps/web/src/lib/services/chainRegistry.ts resolves FURLPAY_* vars).
  const record = {
    network: network.name,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    usdc,
    contracts: {
      FurlPayRouter: await router.getAddress(),
      X402Facilitator: await facilitator.getAddress(),
      BookingReceipt: await receipt.getAddress(),
      FurlPayEscrow: await escrow.getAddress(),
    },
  };
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${network.name}.json`), JSON.stringify(record, null, 2));
  console.log(`Deployment record: deployments/${network.name}.json\n`);

  console.log("Set these in apps/web (.env.local / Vercel):");
  console.log(`FURLPAY_ROUTER_ADDRESS=${await router.getAddress()}`);
  console.log(`FURLPAY_X402_ADDRESS=${await facilitator.getAddress()}`);
  console.log(`FURLPAY_RECEIPT_ADDRESS=${await receipt.getAddress()}`);
  console.log(`FURLPAY_ESCROW_ADDRESS=${await escrow.getAddress()}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
