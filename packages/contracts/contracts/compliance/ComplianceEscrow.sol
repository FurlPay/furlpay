// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AttestationRegistry} from "./AttestationRegistry.sol";
import {Outcome} from "./IComplianceCheck.sol";

/// @title ComplianceEscrow
/// @notice Holds the pending tranche of a payment that returned PENDING (e.g.
///         amount above the source-of-funds threshold). The X402PolicyWrapper
///         pulls the remainder here via EIP-3009 and calls `open`. Funds are
///         released to the recipient once the payer has a valid source-of-funds
///         attestation, or refunded to the payer after `releaseDeadline`.
///
///         Security posture (this is the ONLY custodial surface in the system):
///           - `Ownable2Step` + `Pausable` + `ReentrancyGuard`
///           - owner-settable `perTxCap` (0 = disabled) bounds exposure per tx
///           - a refund deadline guarantees payer funds can never be trapped
///           - only the wrapper can `open`; anyone can `release` (gated on the
///             on-chain SoF attestation) or `refund` (gated on the deadline)
contract ComplianceEscrow is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum EscrowStatus {
        None,
        Pending,
        Released,
        Refunded
    }

    struct Entry {
        address payer;
        address recipient;
        uint256 amount; // USDC, 6 decimals
        uint64 releaseDeadline;
        EscrowStatus status;
    }

    IERC20 public immutable usdc;
    AttestationRegistry public immutable attestations;

    /// @notice The X402PolicyWrapper — the only address allowed to `open`.
    address public wrapper;

    /// @notice Max USDC held per escrow entry (0 disables the cap). Starts low
    ///         on mainnet and is raised deliberately.
    uint256 public perTxCap;

    mapping(bytes32 txId => Entry) public entries;

    event WrapperUpdated(address indexed previousWrapper, address indexed newWrapper);
    event PerTxCapUpdated(uint256 cap);
    event EscrowOpened(
        bytes32 indexed txId, address indexed payer, address indexed recipient, uint256 amount, uint64 releaseDeadline
    );
    event EscrowReleased(bytes32 indexed txId, address indexed recipient, uint256 amount);
    event EscrowRefunded(bytes32 indexed txId, address indexed payer, uint256 amount);

    error NotWrapper(address caller);
    error EntryExists(bytes32 txId);
    error NotPending(bytes32 txId);
    error ZeroAmount();
    error ZeroAddress();
    error CapExceeded(uint256 amount, uint256 cap);
    error BadDeadline();
    error SoFMissing(address payer);
    error DeadlineNotReached(uint64 releaseDeadline);

    constructor(address usdc_, address attestations_, address owner_) Ownable(owner_) {
        if (usdc_ == address(0) || attestations_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        attestations = AttestationRegistry(attestations_);
    }

    modifier onlyWrapper() {
        if (msg.sender != wrapper) revert NotWrapper(msg.sender);
        _;
    }

    // --- Admin ---------------------------------------------------------------

    function setWrapper(address newWrapper) external onlyOwner {
        if (newWrapper == address(0)) revert ZeroAddress();
        emit WrapperUpdated(wrapper, newWrapper);
        wrapper = newWrapper;
    }

    function setPerTxCap(uint256 cap) external onlyOwner {
        perTxCap = cap;
        emit PerTxCapUpdated(cap);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // --- Escrow lifecycle ----------------------------------------------------

    /// @notice Open an escrow entry. The wrapper MUST have already transferred
    ///         `amount` USDC into this contract (via the payer's EIP-3009
    ///         authorization) before calling.
    function open(bytes32 txId, address payer, address recipient, uint256 amount, uint64 releaseDeadline)
        external
        onlyWrapper
        whenNotPaused
    {
        if (entries[txId].status != EscrowStatus.None) revert EntryExists(txId);
        if (payer == address(0) || recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (perTxCap != 0 && amount > perTxCap) revert CapExceeded(amount, perTxCap);
        if (releaseDeadline <= block.timestamp) revert BadDeadline();

        entries[txId] = Entry({
            payer: payer,
            recipient: recipient,
            amount: amount,
            releaseDeadline: releaseDeadline,
            status: EscrowStatus.Pending
        });

        emit EscrowOpened(txId, payer, recipient, amount, releaseDeadline);
    }

    /// @notice Release the escrowed tranche to the recipient once the payer has
    ///         a valid on-chain source-of-funds attestation. Permissionless: the
    ///         gate is the attestation, not the caller.
    function release(bytes32 txId) external nonReentrant {
        Entry storage e = entries[txId];
        if (e.status != EscrowStatus.Pending) revert NotPending(txId);
        if (!attestations.hasValidSoF(e.payer)) revert SoFMissing(e.payer);

        e.status = EscrowStatus.Released;
        usdc.safeTransfer(e.recipient, e.amount);

        // Finalize the transaction-linked attestation as PASS.
        attestations.recordOutcome(txId, Outcome.PASS, "SOF_RESOLVED");
        emit EscrowReleased(txId, e.recipient, e.amount);
    }

    /// @notice Refund the escrowed tranche to the payer after the deadline if it
    ///         was never resolved — payer funds are never trapped.
    function refund(bytes32 txId) external nonReentrant {
        Entry storage e = entries[txId];
        if (e.status != EscrowStatus.Pending) revert NotPending(txId);
        if (block.timestamp < e.releaseDeadline) revert DeadlineNotReached(e.releaseDeadline);

        e.status = EscrowStatus.Refunded;
        usdc.safeTransfer(e.payer, e.amount);

        attestations.recordOutcome(txId, Outcome.FAIL, "SOF_TIMEOUT");
        emit EscrowRefunded(txId, e.payer, e.amount);
    }
}
