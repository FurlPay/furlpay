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

    // --- Circle Arc ---------------------------------------------------------
    // Values verified against the LIVE RPC on 2026-09-25, not copied from docs:
    //   mainnet  eth_chainId -> 0x13b2   (5042)
    //   testnet  chain id      5042002   (docs.arc.io/arc/references/rpc-endpoints)
    //
    // GAS IS USDC HERE. Hardhat/ethers model gas in the chain's native unit and
    // Arc's native unit IS USDC at 18 decimals, so no plugin change is needed —
    // but a deployment's cost is denominated in dollars, and the deployer must
    // hold USDC on Arc rather than ETH. A deployer funded with ETH has nothing
    // to pay gas with and every transaction fails at estimation.
    //
    // Deploy TESTNET FIRST. Faucet: https://faucet.circle.com
    arcTestnet: {
      url: process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.io",
      chainId: 5042002,
      accounts,
    },
    arcMainnet: {
      url: process.env.ARC_RPC_URL || "https://rpc.mainnet.arc.io",
      chainId: 5042,
      // A SEPARATE key from every other network, deliberately. The same
      // `accounts` array on mainnet and testnet is how a testnet deploy script
      // run with the wrong --network signs with a production key.
      accounts: process.env.ARC_MAINNET_DEPLOYER_PRIVATE_KEY
        ? [process.env.ARC_MAINNET_DEPLOYER_PRIVATE_KEY]
        : [],
    },
  },
  etherscan: {
    apiKey: {
      arbitrumSepolia: process.env.ARBISCAN_API_KEY || "",
      arbitrumOne: process.env.ARBISCAN_API_KEY || "",
      // Arc's explorer is documented as requiring permissioned access, so
      // automated source verification may not be available through the
      // Etherscan plugin. Left unset rather than pointed at a guessed URL:
      // a wrong customChains entry fails verification confusingly, and
      // verification is the one deployment step worth doing by hand.
    },
  },
};

export default config;
