import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@/lib/evm/rlp";
import type { AssetDelta, ScanFinding, ScanResult, TxCategory } from "./types";
import { worstRisk } from "./types";

// ---------------------------------------------------------------------------
// Local calldata analysis. Pure, offline, and never skipped.
//
// This is layer 1 of two (see ./types.ts). Its job is not to be as capable as a
// simulating provider — it cannot be, it has no chain state — but to be the
// layer that is ALWAYS THERE. Every check here works on a plane, on a throttled
// connection, and while the scanning vendor is having an incident.
//
// SELECTORS ARE COMPUTED, NOT PASTED, for the reason lib/evm/erc20.ts gives:
// `0x095ea7b3` is four bytes nobody can review, and a transposed digit silently
// classifies an approval as an unknown call — which is exactly the case this
// file exists to catch.
//
// EVERY UNRECOGNISED THING IS "unknown", NEVER "safe". The default verdict of a
// decoder that did not recognise the calldata is that it does not know what the
// transaction does. Calling that safe is how a wallet ends up reassuring a user
// about a function it has never seen.
// ---------------------------------------------------------------------------

function selector(signature: string): string {
  return bytesToHex(keccak_256(new TextEncoder().encode(signature)).slice(0, 4));
}

export const SELECTORS = {
  erc20Transfer: selector("transfer(address,uint256)"),
  erc20TransferFrom: selector("transferFrom(address,address,uint256)"),
  erc20Approve: selector("approve(address,uint256)"),
  erc20IncreaseAllowance: selector("increaseAllowance(address,uint256)"),
  erc721SafeTransferFrom: selector("safeTransferFrom(address,address,uint256)"),
  erc721SafeTransferFromData: selector("safeTransferFrom(address,address,uint256,bytes)"),
  erc721SetApprovalForAll: selector("setApprovalForAll(address,bool)"),
  erc1155SafeTransferFrom: selector("safeTransferFrom(address,address,uint256,uint256,bytes)"),
  permit2Approve: selector("approve(address,address,uint160,uint48)"),
} as const;

/**
 * The uint256 maximum, and the ERC-20 convention for "unlimited".
 *
 * Checked as a THRESHOLD rather than an equality: contracts and front-ends use
 * `2^256-1`, `2^255-1` and other near-maximum sentinels interchangeably, and an
 * equality check silently lets `2^255` through as an ordinary amount. Anything
 * above 2^128 is more than the total supply of every real token, so it is an
 * unlimited approval whatever the exact constant.
 */
const UNLIMITED_THRESHOLD = 1n << 128n;
export const UINT256_MAX = (1n << 256n) - 1n;

export interface AnalyzeInput {
  chainId: number;
  from: string;
  to: string;
  value: bigint;
  data: string;
  /** Addresses the app already trusts: the user's own, saved contacts, known routers. */
  knownAddresses?: Record<string, string>;
  /** Contracts the token catalogue vouches for, lowercased. */
  verifiedContracts?: Set<string>;
}

/** ABI word `n` (32 bytes) of the argument area, as a bigint. */
function word(data: string, n: number): bigint | null {
  const start = 10 + n * 64; // "0x" + 8 selector chars
  const hex = data.slice(start, start + 64);
  if (hex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return BigInt(`0x${hex}`);
}

/** ABI word `n` read as an address (low 20 bytes). */
function addressAt(data: string, n: number): string | null {
  const v = word(data, n);
  if (v === null) return null;
  const hex = v.toString(16).padStart(64, "0");
  // The high 12 bytes of an address word must be zero. A non-zero high half is
  // either a different type being misread as an address or a deliberately
  // malformed payload; treating it as an address would render a plausible but
  // wrong counterparty on the confirmation screen.
  if (hex.slice(0, 24) !== "0".repeat(24)) return null;
  return `0x${hex.slice(24)}`;
}

export function analyzeTransaction(input: AnalyzeInput): ScanResult {
  const data = (input.data || "0x").toLowerCase();
  const findings: ScanFinding[] = [];
  const deltas: AssetDelta[] = [];
  const known = input.knownAddresses ?? {};
  const verified = input.verifiedContracts ?? new Set<string>();
  const to = input.to.toLowerCase();

  let category: TxCategory = "unknown";

  // --- plain native transfer ------------------------------------------------
  if (data === "0x" || data === "") {
    category = "native_transfer";
    if (input.value > 0n) {
      deltas.push({ rawAmount: -input.value, decimals: 18, symbol: "native", contract: null, kind: "native" });
    } else {
      // Zero value, zero calldata: costs gas and does nothing observable. Almost
      // always a mistake or a probe, and worth saying so rather than waving through.
      findings.push({
        id: "empty_transaction",
        level: "caution",
        title: "This transaction does nothing",
        detail: "It sends no funds and calls no contract, but you would still pay the network fee.",
      });
    }
  } else {
    const sel = data.slice(0, 10);

    switch (sel) {
      case SELECTORS.erc20Approve:
      case SELECTORS.erc20IncreaseAllowance: {
        category = "token_approval";
        const spender = addressAt(data, 0);
        const amount = word(data, 1);
        findings.push(...approvalFindings(spender, amount, known, verified));
        break;
      }
      case SELECTORS.erc721SetApprovalForAll: {
        category = "nft_approval_all";
        const operator = addressAt(data, 0);
        const approved = word(data, 1);
        if (approved !== null && approved !== 0n) {
          findings.push({
            id: "nft_approval_all",
            // Always danger, never merely caution: this grants transfer rights
            // over EVERY token in the collection, present and future, with no
            // amount to cap the loss. It is the single most common mechanism
            // behind NFT drains.
            level: "danger",
            title: "Full access to an entire NFT collection",
            detail: operator
              ? `${labelFor(operator, known)} would be able to move every NFT you own in this collection, now and in future, until you revoke it.`
              : "A contract would be able to move every NFT you own in this collection.",
          });
        } else {
          findings.push({
            id: "nft_approval_revoke",
            level: "safe",
            title: "Revoking collection access",
            detail: "This removes an operator's permission to move your NFTs.",
          });
        }
        break;
      }
      case SELECTORS.erc20Transfer: {
        category = "token_transfer";
        const recipient = addressAt(data, 0);
        const amount = word(data, 1);
        if (recipient && amount !== null) {
          deltas.push({ rawAmount: -amount, decimals: 18, symbol: "token", contract: to, kind: "erc20" });
          findings.push(...recipientFindings(recipient, input.from, known));
        }
        break;
      }
      case SELECTORS.erc20TransferFrom: {
        category = "token_transfer";
        const owner = addressAt(data, 0);
        const recipient = addressAt(data, 1);
        // Moving someone else's tokens is normal inside a swap router and
        // alarming in a direct call from a wallet, because it means an
        // allowance is being spent rather than granted.
        if (owner && owner.toLowerCase() === input.from.toLowerCase() && recipient) {
          findings.push(...recipientFindings(recipient, input.from, known));
        }
        break;
      }
      case SELECTORS.erc721SafeTransferFrom:
      case SELECTORS.erc721SafeTransferFromData:
      case SELECTORS.erc1155SafeTransferFrom: {
        category = "nft_transfer";
        const recipient = addressAt(data, 1);
        const tokenId = word(data, 2);
        if (recipient) findings.push(...recipientFindings(recipient, input.from, known));
        deltas.push({
          rawAmount: -1n,
          decimals: 0,
          symbol: "NFT",
          contract: to,
          kind: sel === SELECTORS.erc1155SafeTransferFrom ? "erc1155" : "erc721",
          tokenId: tokenId?.toString(),
        });
        break;
      }
      case SELECTORS.permit2Approve: {
        category = "token_approval";
        const spender = addressAt(data, 1);
        const amount = word(data, 2);
        findings.push(...approvalFindings(spender, amount, known, verified));
        break;
      }
      default: {
        category = "contract_call";
        findings.push({
          id: "unrecognised_call",
          level: "unknown",
          title: "FurlPay cannot read this transaction",
          detail:
            "It calls a contract function this app does not recognise, so it cannot tell you what it will do. " +
            "Only continue if you trust the site and understand the action you started.",
        });
      }
    }

    // Native value alongside calldata is legitimate (a payable mint, a deposit)
    // but it is value leaving the wallet in addition to whatever the call does,
    // and it is regularly missed by users reading only the function name.
    if (input.value > 0n) {
      deltas.push({ rawAmount: -input.value, decimals: 18, symbol: "native", contract: null, kind: "native" });
      if (category === "token_approval" || category === "nft_approval_all") {
        findings.push({
          id: "value_with_approval",
          level: "danger",
          title: "This approval also sends funds",
          detail: "An approval should not move any of the network's own coin. This one does.",
        });
      }
    }
  }

  // Contract familiarity, applied to every category that touches one.
  if (category !== "native_transfer" && to && !verified.has(to) && !known[to]) {
    findings.push({
      id: "unknown_contract",
      level: "caution",
      title: "First time interacting with this contract",
      detail: `${short(to)} is not in FurlPay's verified list and you have not used it before.`,
    });
  }

  if (to === input.from.toLowerCase()) {
    findings.push({
      id: "self_send",
      level: "caution",
      title: "Sending to your own address",
      detail: "The recipient is this wallet. You would pay a network fee to move funds to yourself.",
    });
  }

  const level = findings.length === 0 ? "safe" : worstRisk(findings.map((f) => f.level));

  return {
    level,
    category,
    findings,
    deltas,
    simulated: false,
    sources: ["local"],
    contract: category === "native_transfer" ? undefined : { address: to, verified: verified.has(to), label: known[to] },
  };
}

function approvalFindings(
  spender: string | null,
  amount: bigint | null,
  known: Record<string, string>,
  verified: Set<string>,
): ScanFinding[] {
  const out: ScanFinding[] = [];

  if (amount === null || spender === null) {
    out.push({
      id: "approval_unreadable",
      level: "danger",
      title: "This approval cannot be read",
      detail: "FurlPay could not decode who is being approved or for how much. Do not continue.",
    });
    return out;
  }

  if (amount === 0n) {
    out.push({
      id: "approval_revoke",
      level: "safe",
      title: "Revoking an allowance",
      detail: `${labelFor(spender, known)} will no longer be able to move this token on your behalf.`,
    });
    return out;
  }

  if (amount >= UNLIMITED_THRESHOLD) {
    out.push({
      id: "unlimited_approval",
      level: "danger",
      title: "Unlimited spending approval",
      detail:
        `${labelFor(spender, known)} would be able to move this token from your wallet without limit, ` +
        "for as long as the approval stands. Approve only the amount you are spending.",
    });
  } else {
    out.push({
      id: "approval",
      level: "caution",
      title: "Spending approval",
      detail: `${labelFor(spender, known)} would be able to move this token from your wallet up to the approved amount.`,
    });
  }

  const spenderLower = spender.toLowerCase();
  if (!verified.has(spenderLower) && !known[spenderLower]) {
    out.push({
      id: "unknown_spender",
      level: "caution",
      title: "Approving an unfamiliar address",
      detail: `${short(spender)} is not a contract FurlPay recognises.`,
    });
  }

  return out;
}

function recipientFindings(recipient: string, from: string, known: Record<string, string>): ScanFinding[] {
  const out: ScanFinding[] = [];
  const lower = recipient.toLowerCase();

  // The zero address is a burn. Some tokens genuinely burn this way, so it is
  // not refused — but it is irreversible and no UI should let it pass silently.
  if (lower === "0x0000000000000000000000000000000000000000") {
    out.push({
      id: "burn_address",
      level: "danger",
      title: "Sending to the zero address",
      detail: "Anything sent here is destroyed permanently and cannot be recovered by anyone.",
    });
  }
  if (lower === from.toLowerCase()) {
    out.push({
      id: "recipient_is_self",
      level: "caution",
      title: "You are the recipient",
      detail: "This transfer sends the tokens back to this wallet.",
    });
  }
  if (!known[lower] && lower !== "0x0000000000000000000000000000000000000000") {
    out.push({
      id: "new_recipient",
      // `safe`, so it contributes nothing to the overall level: sending to
      // someone for the first time is normal and is not evidence of anything.
      // It is worth SAYING (it is the moment an address-poisoning swap would
      // bite) without colouring the whole transaction as risky — a screen where
      // every ordinary transfer shows a warning is a screen users stop reading.
      // `toMoneyWarnings` renders this tier as an info note.
      level: "safe",
      title: "New recipient",
      detail: `${short(recipient)} is not in your address book.`,
    });
  }
  return out;
}

function labelFor(address: string, known: Record<string, string>): string {
  return known[address.toLowerCase()] ?? short(address);
}

/** Head and tail, never a truncated prefix alone — a prefix is what lookalike
 *  address attacks are built to match. */
export function short(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}
