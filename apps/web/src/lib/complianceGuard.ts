import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";

// ---------------------------------------------------------------------------
// complianceGuard — server-side client for the on-chain programmable-compliance
// guardrail (X402PolicyWrapper + PolicyManager + AttestationRegistry +
// ComplianceEscrow + SanctionsRegistry) deployed on Arbitrum One.
//
// Reads go over a public RPC; writes (settlement, SoF attestations, escrow
// resolution) are signed by a relayer/attestor key held only in server env.
// Nothing here is mocked: if the contracts/keys aren't configured the calls
// throw GuardNotConfiguredError and the routes return 503 — an honest
// "not deployed yet" rather than a fake success.
// ---------------------------------------------------------------------------

const RPC_URL = process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc";
const USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address;

export class GuardNotConfiguredError extends Error {
  constructor(what: string) {
    super(`compliance guard not configured: ${what}`);
    this.name = "GuardNotConfiguredError";
  }
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export interface GuardAddresses {
  policyWrapper?: Address;
  policyManager?: Address;
  attestationRegistry?: Address;
  sanctionsRegistry?: Address;
  complianceEscrow?: Address;
}

export function getGuardAddresses(): GuardAddresses {
  return {
    policyWrapper: env("FURLPAY_POLICY_WRAPPER_ADDRESS") as Address | undefined,
    policyManager: env("FURLPAY_POLICY_MANAGER_ADDRESS") as Address | undefined,
    attestationRegistry: env("FURLPAY_ATTESTATION_REGISTRY_ADDRESS") as Address | undefined,
    sanctionsRegistry: env("FURLPAY_SANCTIONS_REGISTRY_ADDRESS") as Address | undefined,
    complianceEscrow: env("FURLPAY_COMPLIANCE_ESCROW_ADDRESS") as Address | undefined,
  };
}

export function guardStatus() {
  const a = getGuardAddresses();
  return {
    chain: "arbitrum",
    chainId: arbitrum.id,
    usdc: USDC_ADDRESS,
    addresses: a,
    readReady: Boolean(a.policyManager && a.attestationRegistry),
    settleReady: Boolean(a.policyWrapper && env("FURLPAY_RELAYER_PRIVATE_KEY")),
    attestReady: Boolean(a.attestationRegistry && env("FURLPAY_ATTESTOR_PRIVATE_KEY")),
    explorer: "https://arbiscan.io",
  };
}

// --- ABIs (minimal surfaces) ------------------------------------------------

const POLICY_MANAGER_ABI = parseAbi([
  "function evaluate((address payer, address recipient, uint256 amount, bytes32 txId) ctx) view returns (uint8 outcome, bytes32 reason)",
]);

const ATTESTATION_ABI = parseAbi([
  "function txAttestations(bytes32) view returns (uint8 outcome, bytes32 reason, uint64 timestamp, bool exists)",
  "function hasValidSoF(address) view returns (bool)",
  "function recordSoF(address subject, bytes32 evidenceHash, uint64 expiry)",
]);

const SANCTIONS_ABI = parseAbi(["function isSanctioned(address) view returns (bool)"]);

const ESCROW_ABI = parseAbi([
  "function entries(bytes32) view returns (address payer, address recipient, uint256 amount, uint64 releaseDeadline, uint8 status)",
  "function release(bytes32 txId)",
  "function refund(bytes32 txId)",
]);

const WRAPPER_ABI = parseAbi([
  "function settleWithPolicy(address from, address to, (uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) auth, bytes32 resourceHash, bytes32 txId) returns (uint8)",
  "function settleTranche(address from, address to, (uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) compliantAuth, (uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) escrowAuth, bytes32 resourceHash, bytes32 txId, uint64 releaseDeadline)",
]);

// --- Clients (lazy singletons) ----------------------------------------------

let _public: PublicClient | undefined;
function publicClient(): PublicClient {
  if (!_public) {
    _public = createPublicClient({ chain: arbitrum, transport: http(RPC_URL) });
  }
  return _public;
}

function walletFor(keyEnv: string): { client: WalletClient; account: ReturnType<typeof privateKeyToAccount> } {
  const key = env(keyEnv);
  if (!key) throw new GuardNotConfiguredError(keyEnv);
  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
  const client = createWalletClient({ account, chain: arbitrum, transport: http(RPC_URL) });
  return { client, account };
}

// --- Types ------------------------------------------------------------------

export type Outcome = "PASS" | "FAIL" | "PENDING";
const OUTCOMES: Outcome[] = ["PASS", "FAIL", "PENDING"];

export interface Authorization {
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  v: number;
  r: Hex;
  s: Hex;
}

export function reasonToString(reason: Hex): string {
  // bytes32 short-string → utf8, trimming trailing zero bytes.
  const hex = reason.slice(2).replace(/(00)+$/, "");
  if (!hex) return "";
  return Buffer.from(hex, "hex").toString("utf8");
}

export function resourceHash(resource: string): Hex {
  return keccak256(toHex(resource));
}

// --- Reads ------------------------------------------------------------------

export interface EvaluateInput {
  payer: Address;
  recipient: Address;
  amount: bigint; // USDC atomic (6dp)
  txId: Hex;
}

export async function evaluatePolicy(input: EvaluateInput): Promise<{ outcome: Outcome; reason: string }> {
  const { policyManager } = getGuardAddresses();
  if (!policyManager) throw new GuardNotConfiguredError("FURLPAY_POLICY_MANAGER_ADDRESS");
  const [outcome, reason] = await publicClient().readContract({
    address: policyManager,
    abi: POLICY_MANAGER_ABI,
    functionName: "evaluate",
    args: [{ payer: input.payer, recipient: input.recipient, amount: input.amount, txId: input.txId }],
  });
  return { outcome: OUTCOMES[Number(outcome)] ?? "FAIL", reason: reasonToString(reason as Hex) };
}

export async function readAttestation(txId: Hex) {
  const { attestationRegistry } = getGuardAddresses();
  if (!attestationRegistry) throw new GuardNotConfiguredError("FURLPAY_ATTESTATION_REGISTRY_ADDRESS");
  const [outcome, reason, timestamp, exists] = await publicClient().readContract({
    address: attestationRegistry,
    abi: ATTESTATION_ABI,
    functionName: "txAttestations",
    args: [txId],
  });
  return {
    exists: exists as boolean,
    outcome: OUTCOMES[Number(outcome)] ?? "PASS",
    reason: reasonToString(reason as Hex),
    timestamp: Number(timestamp),
  };
}

export async function hasValidSoF(subject: Address): Promise<boolean> {
  const { attestationRegistry } = getGuardAddresses();
  if (!attestationRegistry) throw new GuardNotConfiguredError("FURLPAY_ATTESTATION_REGISTRY_ADDRESS");
  return publicClient().readContract({
    address: attestationRegistry,
    abi: ATTESTATION_ABI,
    functionName: "hasValidSoF",
    args: [subject],
  });
}

export async function isSanctioned(account: Address): Promise<boolean> {
  const { sanctionsRegistry } = getGuardAddresses();
  if (!sanctionsRegistry) throw new GuardNotConfiguredError("FURLPAY_SANCTIONS_REGISTRY_ADDRESS");
  return publicClient().readContract({
    address: sanctionsRegistry,
    abi: SANCTIONS_ABI,
    functionName: "isSanctioned",
    args: [account],
  });
}

export async function readEscrowEntry(txId: Hex) {
  const { complianceEscrow } = getGuardAddresses();
  if (!complianceEscrow) throw new GuardNotConfiguredError("FURLPAY_COMPLIANCE_ESCROW_ADDRESS");
  const [payer, recipient, amount, releaseDeadline, status] = await publicClient().readContract({
    address: complianceEscrow,
    abi: ESCROW_ABI,
    functionName: "entries",
    args: [txId],
  });
  const STATUS = ["None", "Pending", "Released", "Refunded"] as const;
  return { payer, recipient, amount, releaseDeadline: Number(releaseDeadline), status: STATUS[Number(status)] };
}

// --- Writes -----------------------------------------------------------------

async function send(hash: Hex): Promise<{ txHash: Hex; blockNumber: number; status: "success" | "reverted" }> {
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  return { txHash: hash, blockNumber: Number(receipt.blockNumber), status: receipt.status };
}

export async function settleWithPolicy(params: {
  from: Address;
  to: Address;
  auth: Authorization;
  resource: string;
  txId: Hex;
}) {
  const { policyWrapper } = getGuardAddresses();
  if (!policyWrapper) throw new GuardNotConfiguredError("FURLPAY_POLICY_WRAPPER_ADDRESS");
  const { client, account } = walletFor("FURLPAY_RELAYER_PRIVATE_KEY");
  const hash = await client.writeContract({
    account,
    chain: arbitrum,
    address: policyWrapper,
    abi: WRAPPER_ABI,
    functionName: "settleWithPolicy",
    args: [params.from, params.to, params.auth, resourceHash(params.resource), params.txId],
  });
  return send(hash);
}

export async function settleTranche(params: {
  from: Address;
  to: Address;
  compliantAuth: Authorization;
  escrowAuth: Authorization;
  resource: string;
  txId: Hex;
  releaseDeadline: bigint;
}) {
  const { policyWrapper } = getGuardAddresses();
  if (!policyWrapper) throw new GuardNotConfiguredError("FURLPAY_POLICY_WRAPPER_ADDRESS");
  const { client, account } = walletFor("FURLPAY_RELAYER_PRIVATE_KEY");
  const hash = await client.writeContract({
    account,
    chain: arbitrum,
    address: policyWrapper,
    abi: WRAPPER_ABI,
    functionName: "settleTranche",
    args: [
      params.from,
      params.to,
      params.compliantAuth,
      params.escrowAuth,
      resourceHash(params.resource),
      params.txId,
      params.releaseDeadline,
    ],
  });
  return send(hash);
}

export async function recordSoF(subject: Address, evidenceHash: Hex, expiry: bigint) {
  const { attestationRegistry } = getGuardAddresses();
  if (!attestationRegistry) throw new GuardNotConfiguredError("FURLPAY_ATTESTATION_REGISTRY_ADDRESS");
  const { client, account } = walletFor("FURLPAY_ATTESTOR_PRIVATE_KEY");
  const hash = await client.writeContract({
    account,
    chain: arbitrum,
    address: attestationRegistry,
    abi: ATTESTATION_ABI,
    functionName: "recordSoF",
    args: [subject, evidenceHash, expiry],
  });
  return send(hash);
}

export async function resolveEscrow(txId: Hex, action: "release" | "refund") {
  const { complianceEscrow } = getGuardAddresses();
  if (!complianceEscrow) throw new GuardNotConfiguredError("FURLPAY_COMPLIANCE_ESCROW_ADDRESS");
  const { client, account } = walletFor("FURLPAY_RELAYER_PRIVATE_KEY");
  const hash = await client.writeContract({
    account,
    chain: arbitrum,
    address: complianceEscrow,
    abi: ESCROW_ABI,
    functionName: action,
    args: [txId],
  });
  return send(hash);
}
