import baseConfig from "./hardhat.config";
import { HardhatUserConfig } from "hardhat/config";

// Local payroll end-to-end config: an in-memory node with Arbitrum One's
// chainId (42161), so the EIP-712 domain the web app builds for an Arbitrum
// payroll batch is the one FurlPayRouter hashes against. Nothing here touches
// a real network.
//
//   npx hardhat node --config hardhat.config.localpayroll.ts --port 8546                      # terminal 1
//   npx hardhat run scripts/deploy-router-local.ts --config hardhat.config.localpayroll.ts \
//     --network localhost                                                                      # terminal 2
const config: HardhatUserConfig = {
  ...baseConfig,
  networks: {
    ...baseConfig.networks,
    hardhat: { ...(baseConfig.networks?.hardhat ?? {}), chainId: 42161 },
    localhost: { url: "http://127.0.0.1:8546", chainId: 42161 },
  },
};

export default config;
