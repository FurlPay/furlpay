import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Chain wiring for the compliance-aware agentic payment demo. Talks to the
// on-chain guardrail (X402PolicyWrapper + PolicyManager + AttestationRegistry +
// ComplianceEscrow) via ethers. Works against any deployment — a local Hardhat
// node, or Arbitrum One — selected by RPC_URL + the FURLPAY_* addresses.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Addresses {
  usdc: string;
  policyWrapper: string;
  policyManager: string;
  attestationRegistry: string;
  complianceEscrow: string;
  sanctionsRegistry?: string;
}

function fromDeploymentRecord(): Partial<Addresses> {
  // Prefer an explicit record path, else the contracts package's arbitrumOne record.
  const candidates = [
    process.env.COMPLIANCE_DEPLOYMENT,
    path.join(__dirname, "../../../contracts/deployments/compliance.arbitrumOne.json"),
    path.join(__dirname, "../../../contracts/deployments/compliance.localhost.json"),
    path.join(__dirname, "../../../contracts/deployments/compliance.hardhat.json"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const r = JSON.parse(fs.readFileSync(p, "utf8"));
      return {
        usdc: r.usdc,
        policyWrapper: r.contracts.X402PolicyWrapper,
        policyManager: r.contracts.PolicyManager,
        attestationRegistry: r.contracts.AttestationRegistry,
        complianceEscrow: r.contracts.ComplianceEscrow,
        sanctionsRegistry: r.contracts.SanctionsRegistry,
      };
    }
  }
  return {};
}

export function getAddresses(): Addresses {
  const rec = fromDeploymentRecord();
  const a: Addresses = {
    usdc: process.env.USDC_ADDRESS || rec.usdc || "",
    policyWrapper: process.env.FURLPAY_POLICY_WRAPPER_ADDRESS || rec.policyWrapper || "",
    policyManager: process.env.FURLPAY_POLICY_MANAGER_ADDRESS || rec.policyManager || "",
    attestationRegistry:
      process.env.FURLPAY_ATTESTATION_REGISTRY_ADDRESS || rec.attestationRegistry || "",
    complianceEscrow: process.env.FURLPAY_COMPLIANCE_ESCROW_ADDRESS || rec.complianceEscrow || "",
    sanctionsRegistry: process.env.FURLPAY_SANCTIONS_REGISTRY_ADDRESS || rec.sanctionsRegistry,
  };
  for (const [k, v] of Object.entries(a)) {
    if (!v && k !== "sanctionsRegistry") throw new Error(`Missing address: ${k} (set FURLPAY_* env or a deployment record)`);
  }
  return a;
}

export const POLICY_MANAGER_ABI = [
  "function evaluate((address payer,address recipient,uint256 amount,bytes32 txId) ctx) view returns (uint8 outcome, bytes32 reason)",
];
export const ATTESTATION_ABI = [
  "function txAttestations(bytes32) view returns (uint8 outcome, bytes32 reason, uint64 timestamp, bool exists)",
  "function hasValidSoF(address) view returns (bool)",
  "function recordSoF(address subject, bytes32 evidenceHash, uint64 expiry)",
];
export const ESCROW_ABI = [
  "function entries(bytes32) view returns (address payer,address recipient,uint256 amount,uint64 releaseDeadline,uint8 status)",
  "function release(bytes32 txId)",
  "function refund(bytes32 txId)",
];
export const WRAPPER_ABI = [
  "function settleWithPolicy(address from, address to, (uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s) auth, bytes32 resourceHash, bytes32 txId) returns (uint8)",
  "function settleTranche(address from, address to, (uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s) compliantAuth, (uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s) escrowAuth, bytes32 resourceHash, bytes32 txId, uint64 releaseDeadline)",
];
export const USDC_ABI = [
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
];

export interface Authorization {
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: string;
  v: number;
  r: string;
  s: string;
}

export const OUTCOME = ["PASS", "FAIL", "PENDING"] as const;
export type Outcome = (typeof OUTCOME)[number];

export function reasonToString(reason: string): string {
  try {
    return ethers.decodeBytes32String(reason);
  } catch {
    return reason;
  }
}

export function makeContext() {
  const rpc = process.env.RPC_URL || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpc);
  const addresses = getAddresses();
  return { provider, addresses, rpc };
}

/** Sign an EIP-3009 transferWithAuthorization for USDC and return the tuple. */
export async function signAuthorization(
  wallet: ethers.Wallet,
  usdcAddress: string,
  to: string,
  value: bigint,
  chainId: number,
): Promise<Authorization> {
  const usdc = new ethers.Contract(usdcAddress, USDC_ABI, wallet.provider);
  let name = "USD Coin";
  let version = "2";
  try {
    name = await usdc.name();
    version = await usdc.version();
  } catch {
    /* MockUSDC / defaults */
  }
  const now = Math.floor(Date.now() / 1000);
  const msg = {
    from: wallet.address,
    to,
    value,
    validAfter: 0,
    validBefore: now + 3600,
    nonce: ethers.hexlify(ethers.randomBytes(32)),
  };
  const domain = { name, version, chainId, verifyingContract: usdcAddress };
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const sig = ethers.Signature.from(await wallet.signTypedData(domain, types, msg));
  return {
    value,
    validAfter: BigInt(msg.validAfter),
    validBefore: BigInt(msg.validBefore),
    nonce: msg.nonce,
    v: sig.v,
    r: sig.r,
    s: sig.s,
  };
}
