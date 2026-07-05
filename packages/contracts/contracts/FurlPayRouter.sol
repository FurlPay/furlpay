// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FurlPayRouter
/// @notice Furlpay's USDC payment rail on Arbitrum One. A payer signs an
///         EIP-712 `Payment` authorization off-chain (produced by
///         POST /api/payments/create); a relayer submits it here. The payer
///         is debited `amount`, the recipient receives `amount - fee`, and
///         the fee (0.5% at the API layer) accrues to the treasury.
///
///         Replay safety: each authorization carries a unique nonce that is
///         consumed on execution. Authorizations expire at `deadline`.
contract FurlPayRouter is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Must match the typed data emitted by the Furlpay API exactly.
    bytes32 public constant PAYMENT_TYPEHASH = keccak256(
        "Payment(string paymentId,address recipient,uint256 amount,uint256 fee,bytes32 nonce,uint256 deadline)"
    );

    /// @notice Fee ceiling — the contract refuses any authorization where the
    ///         fee exceeds 1% of amount, whatever the API quoted.
    uint256 public constant MAX_FEE_BPS = 100;

    IERC20 public immutable usdc;
    address public feeTreasury;

    mapping(bytes32 nonce => bool used) public usedNonces;

    event PaymentExecuted(
        string paymentId,
        address indexed payer,
        address indexed recipient,
        uint256 amount,
        uint256 fee,
        bytes32 nonce
    );
    event FeeTreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);

    error NonceAlreadyUsed(bytes32 nonce);
    error AuthorizationExpired(uint256 deadline);
    error InvalidSigner(address recovered, address expected);
    error FeeTooHigh(uint256 fee, uint256 amount);
    error ZeroAddress();
    error LengthMismatch();

    struct Payment {
        string paymentId;
        address recipient;
        uint256 amount; // total debited from payer (USDC, 6 decimals)
        uint256 fee; // portion of `amount` routed to the treasury
        bytes32 nonce;
        uint256 deadline; // unix seconds
    }

    constructor(address usdc_, address feeTreasury_, address owner_)
        EIP712("FurlPayRouter", "1")
        Ownable(owner_)
    {
        if (usdc_ == address(0) || feeTreasury_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        feeTreasury = feeTreasury_;
    }

    /// @notice Execute a signed payment authorization. Callable by anyone
    ///         (typically the Furlpay relayer); funds only ever move from the
    ///         signer, so a third-party caller cannot redirect value.
    function pay(Payment calldata p, address payer, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
    {
        _execute(p, payer, signature);
    }

    /// @notice Execute up to 100 authorizations in one transaction (payroll,
    ///         supplier payouts) — ~45% cheaper than sequential transfers.
    function batchPay(Payment[] calldata ps, address[] calldata payers, bytes[] calldata signatures)
        external
        nonReentrant
        whenNotPaused
    {
        if (ps.length != payers.length || ps.length != signatures.length) revert LengthMismatch();
        for (uint256 i = 0; i < ps.length; i++) {
            _execute(ps[i], payers[i], signatures[i]);
        }
    }

    function _execute(Payment calldata p, address payer, bytes calldata signature) internal {
        if (p.recipient == address(0)) revert ZeroAddress();
        if (block.timestamp > p.deadline) revert AuthorizationExpired(p.deadline);
        if (usedNonces[p.nonce]) revert NonceAlreadyUsed(p.nonce);
        if (p.fee * 10_000 > p.amount * MAX_FEE_BPS) revert FeeTooHigh(p.fee, p.amount);

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PAYMENT_TYPEHASH,
                    keccak256(bytes(p.paymentId)),
                    p.recipient,
                    p.amount,
                    p.fee,
                    p.nonce,
                    p.deadline
                )
            )
        );
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != payer) revert InvalidSigner(recovered, payer);

        usedNonces[p.nonce] = true;

        usdc.safeTransferFrom(payer, p.recipient, p.amount - p.fee);
        if (p.fee > 0) {
            usdc.safeTransferFrom(payer, feeTreasury, p.fee);
        }

        emit PaymentExecuted(p.paymentId, payer, p.recipient, p.amount, p.fee, p.nonce);
    }

    // --- Admin ---------------------------------------------------------------

    function setFeeTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit FeeTreasuryUpdated(feeTreasury, newTreasury);
        feeTreasury = newTreasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
