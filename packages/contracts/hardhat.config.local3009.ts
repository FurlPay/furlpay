import baseConfig from "./hardhat.config";
import { HardhatUserConfig } from "hardhat/config";

// Local x402 end-to-end config: runs the in-memory node with Arbitrum
// Sepolia's chainId (421614) so EIP-712 domains built by the web app's
// x402 verifier/settler (which map network -> canonical chainId) match the
// chain the MockUSDC contract hashes against on-chain.
//
//   npx hardhat node --config hardhat.config.local3009.ts       # terminal 1
//   npx hardhat run scripts/deploy-mockusdc-local.ts \
//     --config hardhat.config.local3009.ts --network localhost  # terminal 2
const config: HardhatUserConfig = {
  ...baseConfig,
  networks: {
    ...baseConfig.networks,
    hardhat: { ...(baseConfig.networks?.hardhat ?? {}), chainId: 421614 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 421614 },
  },
};

export default config;
