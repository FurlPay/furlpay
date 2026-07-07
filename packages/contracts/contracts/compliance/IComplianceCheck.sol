// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Result of evaluating a payment against a compliance policy.
///         Mirrors the PASS/FAIL/PENDING attestation semantics in
///         "Compliance-Aware Agentic Payments on Stablecoin Rails" (arXiv
///         2605.00071): PASS settles immediately, FAIL blocks settlement,
///         PENDING requires further evidence (resolved via escrow tranching).
enum Outcome {
    PASS,
    FAIL,
    PENDING
}

/// @notice The transaction facts a check evaluates. Kept minimal and
///         value-typed so checks stay pure `view` functions with no state.
struct PaymentContext {
    address payer;
    address recipient;
    uint256 amount; // USDC, 6 decimals
    bytes32 txId; // caller-supplied unique id, binds attestations to this transfer
}

/// @title IComplianceCheck
/// @notice A single, composable compliance module (sanctions, source-of-funds,
///         jurisdiction, …). The PolicyManager runs a set of these in order.
///         Implementations MUST be side-effect free (`view`) so evaluation is
///         deterministic and can be dry-run off-chain before settlement.
interface IComplianceCheck {
    /// @param ctx the transaction being evaluated.
    /// @return outcome PASS / FAIL / PENDING for this check alone.
    /// @return reason short reason code (bytes32 tag); `0x0` on PASS.
    function evaluate(PaymentContext calldata ctx) external view returns (Outcome outcome, bytes32 reason);

    /// @notice Human-readable module name for registry introspection.
    function name() external view returns (string memory);
}
