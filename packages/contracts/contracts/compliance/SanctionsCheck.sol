// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IComplianceCheck, Outcome, PaymentContext} from "./IComplianceCheck.sol";
import {SanctionsRegistry} from "./SanctionsRegistry.sol";

/// @dev Minimal surface of the Chainalysis on-chain Sanctions Oracle. Deployed
///      at 0x40C57923924B5c5c5455c48D93317139ADDaC8fb on Arbitrum One (and most
///      major EVM chains); returns true if `addr` is on OFAC's SDN list.
interface ISanctionsOracle {
    function isSanctioned(address addr) external view returns (bool);
}

/// @title SanctionsCheck
/// @notice FAILs a payment if either the payer or the recipient is sanctioned,
///         per the Chainalysis oracle OR our own OFAC-seeded SanctionsRegistry.
///         The oracle is optional (may be `address(0)` on chains without it) and
///         is consulted defensively via try/catch so a missing/reverting oracle
///         never bricks screening — the registry still applies.
contract SanctionsCheck is IComplianceCheck, Ownable2Step {
    ISanctionsOracle public oracle;
    SanctionsRegistry public registry;

    bytes32 public constant REASON_SANCTIONED = "SANCTIONS";

    event OracleUpdated(address indexed oracle);
    event RegistryUpdated(address indexed registry);

    constructor(address owner_, address oracle_, address registry_) Ownable(owner_) {
        oracle = ISanctionsOracle(oracle_);
        registry = SanctionsRegistry(registry_);
    }

    function setOracle(address oracle_) external onlyOwner {
        oracle = ISanctionsOracle(oracle_);
        emit OracleUpdated(oracle_);
    }

    function setRegistry(address registry_) external onlyOwner {
        registry = SanctionsRegistry(registry_);
        emit RegistryUpdated(registry_);
    }

    function _flagged(address account) internal view returns (bool) {
        if (account == address(0)) return false;
        if (address(registry) != address(0) && registry.isSanctioned(account)) return true;
        if (address(oracle) != address(0)) {
            // Guard the external call: an absent or reverting oracle must not
            // block the registry-based decision.
            try oracle.isSanctioned(account) returns (bool flagged) {
                if (flagged) return true;
            } catch {}
        }
        return false;
    }

    function evaluate(PaymentContext calldata ctx) external view returns (Outcome, bytes32) {
        if (_flagged(ctx.payer) || _flagged(ctx.recipient)) {
            return (Outcome.FAIL, REASON_SANCTIONED);
        }
        return (Outcome.PASS, bytes32(0));
    }

    function name() external pure returns (string memory) {
        return "SanctionsCheck";
    }
}
