// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test-only stand-in for the Chainalysis on-chain Sanctions Oracle
///      (mainnet 0x40C57923924B5c5c5455c48D93317139ADDaC8fb). Same
///      `isSanctioned(address)` surface so SanctionsCheck can be exercised on a
///      local node where the real oracle isn't deployed.
contract MockSanctionsOracle {
    mapping(address => bool) private _sanctioned;

    function setSanctioned(address account, bool sanctioned) external {
        _sanctioned[account] = sanctioned;
    }

    function isSanctioned(address account) external view returns (bool) {
        return _sanctioned[account];
    }
}
