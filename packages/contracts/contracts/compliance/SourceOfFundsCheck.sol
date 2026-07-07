// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IComplianceCheck, Outcome, PaymentContext} from "./IComplianceCheck.sol";
import {AttestationRegistry} from "./AttestationRegistry.sol";

/// @title SourceOfFundsCheck
/// @notice Returns PENDING when a payment exceeds the source-of-funds threshold
///         and the payer has no valid SoF attestation on file — the exact
///         condition the paper resolves via escrow-mediated tranching. Below the
///         threshold, or with a valid attestation, it PASSes.
contract SourceOfFundsCheck is IComplianceCheck, Ownable2Step {
    AttestationRegistry public registry;

    /// @notice Amount (USDC, 6 decimals) above which SoF evidence is required.
    uint256 public threshold;

    bytes32 public constant REASON_SOURCE_OF_FUNDS = "SOURCE_OF_FUNDS";

    event ThresholdUpdated(uint256 threshold);
    event RegistryUpdated(address indexed registry);

    constructor(address owner_, address registry_, uint256 threshold_) Ownable(owner_) {
        registry = AttestationRegistry(registry_);
        threshold = threshold_;
    }

    function setThreshold(uint256 threshold_) external onlyOwner {
        threshold = threshold_;
        emit ThresholdUpdated(threshold_);
    }

    function setRegistry(address registry_) external onlyOwner {
        registry = AttestationRegistry(registry_);
        emit RegistryUpdated(registry_);
    }

    function evaluate(PaymentContext calldata ctx) external view returns (Outcome, bytes32) {
        if (ctx.amount > threshold && !registry.hasValidSoF(ctx.payer)) {
            return (Outcome.PENDING, REASON_SOURCE_OF_FUNDS);
        }
        return (Outcome.PASS, bytes32(0));
    }

    function name() external pure returns (string memory) {
        return "SourceOfFundsCheck";
    }
}
