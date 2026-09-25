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
      // ARC ENFORCES A 20 GWEI MINIMUM BASE FEE, and a transaction below it does
      // not bounce — it may sit pending indefinitely or fail outright, which
      // presents as a deploy that hangs with no receipt and no error. Hardhat's
      // estimator has no way to know that floor, so it is set explicitly.
      //
      // Denominated in USDC, not ether: Arc's native gas token IS USDC, exposed
      // through an 18-decimal native interface alongside the 6-decimal ERC-20.
      // `gwei` here is 1e9 of that 18-decimal unit, so the arithmetic is the
      // usual EVM arithmetic and only the asset differs.
      //
      // Source: docs.arc.io/arc/references/gas-and-fees — EIP-1559 with EWMA
      // smoothing, base fee targeting ~$0.01 and capped at 20,000 gwei. The
      // maxFee below leaves headroom above the floor without approaching that
      // cap; the priority fee is small because Arc's validators are permissioned
      // and there is no auction to win.
      maxFeePerGas: 30_000_000_000, // 30 gwei — 1.5x the 20 gwei floor
      maxPriorityFeePerGas: 1_000_000_000, // 1 gwei
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
      // Same 20 gwei floor as testnet. See the note on arcTestnet.
      maxFeePerGas: 30_000_000_000,
      maxPriorityFeePerGas: 1_000_000_000,
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
