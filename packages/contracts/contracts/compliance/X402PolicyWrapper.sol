// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IComplianceCheck, Outcome, PaymentContext} from "./IComplianceCheck.sol";
import {PolicyManager} from "./PolicyManager.sol";
import {AttestationRegistry} from "./AttestationRegistry.sol";
import {ComplianceEscrow} from "./ComplianceEscrow.sol";

/// @dev EIP-3009 surface of Circle's USDC (FiatTokenV2). Authorizations are
///      signed against the token's own EIP-712 domain, so this wrapper never
///      holds funds or keys on the PASS path — it forwards a payer-signed
///      authorization and can only move funds the payer already authorized.
interface IERC3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title X402PolicyWrapper
/// @notice The x402-compatible entry point to Furlpay's programmable-compliance
///         guardrail (cf. "Compliance-Aware Agentic Payments on Stablecoin
///         Rails", arXiv 2605.00071). A payer/agent signs an EIP-3009 USDC
///         authorization; a relayer submits it here. Rather than settling
///         directly, the wrapper evaluates the transfer against the PolicyManager
///         and enforces the result AT THE POINT OF EXECUTION:
///
///           - PASS    → forward the authorization (payer → recipient). No custody.
///           - FAIL    → record the rejection attestation; do NOT settle.
///           - PENDING → record the pending attestation; do NOT settle. The
///                       compliance agent then resolves it via `settleTranche`.
///
///         Every call writes a transaction-linked PASS/FAIL/PENDING attestation
///         to the AttestationRegistry, producing an inspectable on-chain trail.
contract X402PolicyWrapper is Ownable2Step, Pausable, ReentrancyGuard {
    /// @notice An EIP-3009 `transferWithAuthorization` payload (the X-PAYMENT
    ///         header contents), minus `from`/`to` which the wrapper supplies.
    struct Authorization {
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    IERC3009 public immutable usdc;
    PolicyManager public policyManager;
    AttestationRegistry public attestations;
    ComplianceEscrow public escrow;

    event Settled(bytes32 indexed txId, address indexed payer, address indexed recipient, uint256 amount, bytes32 resourceHash);
    event Rejected(bytes32 indexed txId, address indexed payer, address indexed recipient, uint256 amount, bytes32 reason);
    event Pending(bytes32 indexed txId, address indexed payer, address indexed recipient, uint256 amount, bytes32 reason);
    event TrancheSettled(
        bytes32 indexed txId,
        address indexed payer,
        address indexed recipient,
        uint256 compliantAmount,
        uint256 escrowedAmount,
        uint64 releaseDeadline
    );

    event PolicyManagerUpdated(address indexed policyManager);
    event AttestationsUpdated(address indexed attestations);
    event EscrowUpdated(address indexed escrow);

    error TrancheNotCompliant(bytes32 reason);
    error EscrowNotSet();
    error ZeroAddress();

    constructor(address usdc_, address policyManager_, address attestations_, address escrow_, address owner_)
        Ownable(owner_)
    {
        if (usdc_ == address(0) || policyManager_ == address(0) || attestations_ == address(0)) {
            revert ZeroAddress();
        }
        usdc = IERC3009(usdc_);
        policyManager = PolicyManager(policyManager_);
        attestations = AttestationRegistry(attestations_);
        escrow = ComplianceEscrow(escrow_);
    }

    // --- Admin ---------------------------------------------------------------

    function setPolicyManager(address policyManager_) external onlyOwner {
        if (policyManager_ == address(0)) revert ZeroAddress();
        policyManager = PolicyManager(policyManager_);
        emit PolicyManagerUpdated(policyManager_);
    }

    function setAttestations(address attestations_) external onlyOwner {
        if (attestations_ == address(0)) revert ZeroAddress();
        attestations = AttestationRegistry(attestations_);
        emit AttestationsUpdated(attestations_);
    }

    function setEscrow(address escrow_) external onlyOwner {
        escrow = ComplianceEscrow(escrow_);
        emit EscrowUpdated(escrow_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @dev Forward a payer-signed EIP-3009 authorization. Isolated in its own
    ///      frame both to keep the settlement functions under the stack limit
    ///      and to keep the single fund-moving call in one place.
    function _forward(address from, address to, Authorization calldata auth) internal {
        usdc.transferWithAuthorization(
            from, to, auth.value, auth.validAfter, auth.validBefore, auth.nonce, auth.v, auth.r, auth.s
        );
    }

    // --- Settlement ----------------------------------------------------------

    /// @notice Scenario I — evaluate a payment and settle it if compliant.
    /// @param from payer (must match the EIP-3009 signature).
    /// @param to recipient.
    /// @param auth the payer-signed EIP-3009 authorization.
    /// @param resourceHash keccak256 of the resource the payment buys (x402 binding).
    /// @param txId unique id binding the on-chain attestation to this transfer.
    /// @return outcome the enforced PASS/FAIL/PENDING result.
    function settleWithPolicy(address from, address to, Authorization calldata auth, bytes32 resourceHash, bytes32 txId)
        external
        nonReentrant
        whenNotPaused
        returns (Outcome outcome)
    {
        PaymentContext memory ctx = PaymentContext({payer: from, recipient: to, amount: auth.value, txId: txId});
        bytes32 reason;
        (outcome, reason) = policyManager.evaluate(ctx);

        // Record the attestation FIRST so it persists on every non-reverting path.
        attestations.recordOutcome(txId, outcome, reason);

        if (outcome == Outcome.PASS) {
            _forward(from, to, auth);
            emit Settled(txId, from, to, auth.value, resourceHash);
        } else if (outcome == Outcome.FAIL) {
            // No settlement; the FAIL attestation stands as the on-chain record.
            emit Rejected(txId, from, to, auth.value, reason);
        } else {
            // PENDING: awaits evidence. Resolve via settleTranche once the agent
            // has proposed a compliant split.
            emit Pending(txId, from, to, auth.value, reason);
        }
    }

    /// @notice Scenario II — resolve a PENDING payment by settling a compliant
    ///         tranche to the recipient and escrowing the remainder until the
    ///         payer's source-of-funds attestation is recorded.
    /// @param from payer.
    /// @param to recipient.
    /// @param compliantAuth EIP-3009 auth for the compliant tranche (to = recipient).
    /// @param escrowAuth EIP-3009 auth for the remainder (to = this escrow).
    /// @param resourceHash x402 resource binding.
    /// @param txId unique id (same id used for the PENDING attestation).
    /// @param releaseDeadline after which the escrowed remainder can be refunded.
    function settleTranche(
        address from,
        address to,
        Authorization calldata compliantAuth,
        Authorization calldata escrowAuth,
        bytes32 resourceHash,
        bytes32 txId,
        uint64 releaseDeadline
    ) external nonReentrant whenNotPaused {
        if (address(escrow) == address(0)) revert EscrowNotSet();

        // The compliant tranche must itself pass policy (e.g. be at/under the
        // source-of-funds threshold and sanctions-clean).
        PaymentContext memory ctx =
            PaymentContext({payer: from, recipient: to, amount: compliantAuth.value, txId: txId});
        (Outcome o, bytes32 reason) = policyManager.evaluate(ctx);
        if (o != Outcome.PASS) revert TrancheNotCompliant(reason);

        // 1) Settle the compliant tranche directly to the recipient.
        _forward(from, to, compliantAuth);

        // 2) Pull the remainder into escrow (the payer signed `to = escrow`).
        _forward(from, address(escrow), escrowAuth);

        // 3) Open the escrow entry and keep the tx attestation PENDING until the
        //    escrow releases it (on SoF) or refunds it (on timeout).
        escrow.open(txId, from, to, escrowAuth.value, releaseDeadline);
        attestations.recordOutcome(txId, Outcome.PENDING, "TRANCHED");

        emit TrancheSettled(txId, from, to, compliantAuth.value, escrowAuth.value, releaseDeadline);
        resourceHash; // keep in signature for x402 binding; silence unused-param
    }
}
