import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

// Deployer key is only required for live networks; local hardhat tests run
// without it. Never commit a funded key — use .env (gitignored).
const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // OpenZeppelin 5.x uses mcopy (Cancun). Arbitrum One supports Cancun
      // opcodes since ArbOS 20 — safe for both networks below.
      evmVersion: "cancun",
    },
  },
  networks: {
    // Local node. When ARBITRUM_FORK_RPC is set (an archive RPC, e.g. Alchemy),
    // it forks Arbitrum One so tests run against real USDC + the real Chainalysis
    // oracle. Unset → a plain in-memory node (normal unit tests don't fork).
    hardhat: process.env.ARBITRUM_FORK_RPC
      ? {
          forking: {
            url: process.env.ARBITRUM_FORK_RPC,
            ...(process.env.ARBITRUM_FORK_BLOCK ? { blockNumber: Number(process.env.ARBITRUM_FORK_BLOCK) } : {}),
          },
        }
      : {},
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      accounts,
    },
    arbitrumOne: {
      url: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      arbitrumSepolia: process.env.ARBISCAN_API_KEY || "",
      arbitrumOne: process.env.ARBISCAN_API_KEY || "",
    },
  },
};

export default config;
