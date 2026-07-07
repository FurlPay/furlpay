// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IComplianceCheck, Outcome, PaymentContext} from "./IComplianceCheck.sol";

/// @title PolicyManager
/// @notice Ordered registry of modular compliance checks. `evaluate` runs each
///         check and aggregates the result with FAIL-dominant precedence:
///           - any FAIL      → FAIL   (settlement blocked)
///           - else any PENDING → PENDING (evidence required)
///           - else            → PASS   (settle immediately)
///         This is the off-chain-dry-runnable, on-chain-enforced policy set the
///         X402PolicyWrapper consults at the point of execution.
contract PolicyManager is Ownable2Step {
    /// @dev Evaluation order matters only for which reason code surfaces first;
    ///      the aggregate outcome is order-independent.
    IComplianceCheck[] public checks;

    event CheckAdded(address indexed check, uint256 index);
    event CheckRemoved(address indexed check, uint256 index);

    error IndexOutOfBounds(uint256 index);
    error ZeroAddress();

    constructor(address owner_) Ownable(owner_) {}

    function checksCount() external view returns (uint256) {
        return checks.length;
    }

    /// @notice Append a compliance check to the policy set.
    function addCheck(IComplianceCheck check) external onlyOwner {
        if (address(check) == address(0)) revert ZeroAddress();
        checks.push(check);
        emit CheckAdded(address(check), checks.length - 1);
    }

    /// @notice Remove the check at `index` (swap-and-pop; order not preserved).
    function removeCheck(uint256 index) external onlyOwner {
        uint256 len = checks.length;
        if (index >= len) revert IndexOutOfBounds(index);
        address removed = address(checks[index]);
        checks[index] = checks[len - 1];
        checks.pop();
        emit CheckRemoved(removed, index);
    }

    /// @notice Evaluate `ctx` against every registered check.
    /// @return outcome aggregate PASS/FAIL/PENDING.
    /// @return reason  reason code of the first FAIL, else the first PENDING,
    ///                 else `0x0`.
    function evaluate(PaymentContext calldata ctx) external view returns (Outcome outcome, bytes32 reason) {
        outcome = Outcome.PASS;
        reason = bytes32(0);
        uint256 len = checks.length;
        for (uint256 i = 0; i < len; i++) {
            (Outcome o, bytes32 r) = checks[i].evaluate(ctx);
            if (o == Outcome.FAIL) {
                // FAIL dominates — short-circuit with its reason.
                return (Outcome.FAIL, r);
            }
            if (o == Outcome.PENDING && outcome == Outcome.PASS) {
                outcome = Outcome.PENDING;
                reason = r;
            }
        }
    }
}
