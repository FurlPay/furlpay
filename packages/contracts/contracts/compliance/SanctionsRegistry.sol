// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title SanctionsRegistry
/// @notice Owner/updater-maintained set of sanctioned addresses, seeded from
///         the public OFAC SDN crypto-address list (see scripts/seed-sanctions.ts).
///         Used by SanctionsCheck as a supplement/fallback to the Chainalysis
///         on-chain oracle so screening still works on chains where the oracle
///         is absent, and so newly-published SDN entries can be added before an
///         oracle update propagates.
contract SanctionsRegistry is Ownable2Step {
    mapping(address => bool) private _sanctioned;

    /// @notice Addresses (besides the owner) permitted to mutate the list — the
    ///         off-chain OFAC sync job runs under an updater key, not the owner.
    mapping(address => bool) public isUpdater;

    event SanctionedSet(address indexed account, bool sanctioned);
    event UpdaterSet(address indexed updater, bool allowed);

    error NotUpdater(address caller);

    constructor(address owner_) Ownable(owner_) {}

    modifier onlyUpdater() {
        if (msg.sender != owner() && !isUpdater[msg.sender]) revert NotUpdater(msg.sender);
        _;
    }

    function setUpdater(address updater, bool allowed) external onlyOwner {
        isUpdater[updater] = allowed;
        emit UpdaterSet(updater, allowed);
    }

    function setSanctioned(address account, bool sanctioned) public onlyUpdater {
        _sanctioned[account] = sanctioned;
        emit SanctionedSet(account, sanctioned);
    }

    /// @notice Batch update — used by the OFAC SDN seed/sync script.
    function setSanctionedBatch(address[] calldata accounts, bool sanctioned) external onlyUpdater {
        for (uint256 i = 0; i < accounts.length; i++) {
            _sanctioned[accounts[i]] = sanctioned;
            emit SanctionedSet(accounts[i], sanctioned);
        }
    }

    function isSanctioned(address account) external view returns (bool) {
        return _sanctioned[account];
    }
}
