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
/// @notice Furlpay's USDC payment rail. A payer signs an EIP-712 `Payment`
///         authorization off-chain (produced by POST /api/payments/create); a
///         relayer submits it here. The payer is debited `amount`, the recipient
///         receives `amount - fee`, and the fee (0.5% at the API layer) accrues
///         to the treasury.
///
///         Replay safety: each authorization carries a nonce that is consumed on
///         execution, in the SIGNER'S OWN namespace. Authorizations expire at
///         `deadline`, which may be at most MAX_DEADLINE_WINDOW away.
///
/// @dev CHAIN PORTABILITY. Written for Arbitrum One; also correct on Circle Arc,
///      where it moves USDC through the 6-decimal ERC-20 interface at
///      0x3600…0000 rather than the 18-decimal native one. Cross-chain replay is
///      prevented by EIP-712 itself: OpenZeppelin's implementation puts both
///      `chainId` and `verifyingContract` in the domain separator and recomputes
///      it when `block.chainid` changes, so an authorization signed for Arbitrum
///      cannot be replayed on Arc even at an identical contract address.
///
///      TWO ARC BEHAVIOURS ARE NOT THIS CONTRACT'S TO HANDLE, and are handled
///      off-chain in apps/web/src/lib/chains/ — recorded here so a reader does
///      not conclude they were missed:
///
///        * a transfer to or from a USDC-blocklisted address REVERTS, so one
///          blocklisted party fails an entire `batchPay`. Screen every party
///          before building a batch (arcCompliance.ts). Catching it per-item
///          on-chain would change the atomicity guarantee, which is a product
///          decision rather than a fix.
///        * a transaction below Arc's 20 Gwei minimum base fee is DROPPED with
///          no receipt at all, so it must be refused before submission
///          (assertArcFeeFloor in arc.ts). Nothing on-chain can observe it.
contract FurlPayRouter is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Must match the typed data emitted by the Furlpay API exactly.
    bytes32 public constant PAYMENT_TYPEHASH = keccak256(
        "Payment(string paymentId,address recipient,uint256 amount,uint256 fee,bytes32 nonce,uint256 deadline)"
    );

    /// @notice Fee ceiling — the contract refuses any authorization where the
    ///         fee exceeds 1% of amount, whatever the API quoted.
    uint256 public constant MAX_FEE_BPS = 100;

    /// @notice Hard cap on a single `batchPay`. Previously this bound existed
    ///         only in a docstring ("up to 100 authorizations") while the loop
    ///         was unbounded — an untrue claim in a contract heading for audit.
    ///         Enforced now so the documentation and the code agree.
    uint256 public constant MAX_BATCH = 100;

    /// @notice Longest authorization lifetime the contract will honour.
    ///
    /// @dev A signed authorization plus a standing USDC allowance is a bearer
    ///      instrument: anyone who ever observed it can execute it until it
    ///      expires. Without a bound, a `deadline` of the year 3000 is as valid
    ///      as one 15 minutes out, so a stale authorization could settle long
    ///      after the payer had forgotten it existed.
    ///
    ///      24 hours is deliberately generous — the API issues 900-second
    ///      quotes (EXPIRY_SECONDS in lib/services/payments.ts) — so this bounds
    ///      the abuse window without being able to reject a legitimate quote.
    uint256 public constant MAX_DEADLINE_WINDOW = 24 hours;

    IERC20 public immutable usdc;
    address public feeTreasury;

    /// @notice Consumed authorization nonces, NAMESPACED PER PAYER.
    ///
    /// @dev The per-payer key is a security boundary, not a convenience. A
    ///      single global `mapping(bytes32 => bool)` made a nonce a shared
    ///      resource that any party could consume, which allowed this:
    ///
    ///        1. the attacker observes a pending authorization's nonce — it is
    ///           in the relayer's calldata, so the mempool is enough;
    ///        2. the attacker signs their OWN authorization reusing that nonce,
    ///           with amount = 0 and fee = 0;
    ///        3. a zero-value `transferFrom` needs neither balance nor
    ///           allowance, so it succeeds and marks the nonce used;
    ///        4. the victim's funded authorization now reverts NonceAlreadyUsed,
    ///           permanently. It must be re-signed, and can be killed again.
    ///
    ///      Cost to the attacker: gas. No USDC, no allowance, no relationship to
    ///      the victim. This was demonstrated against the previous version in
    ///      test/routerNonceNamespace.test.ts before the fix.
    ///
    ///      Keying by payer removes the class rather than patching the instance:
    ///      a nonce is only ever consumable by the address that signed it, so
    ///      one payer's choices cannot affect another's. Rejecting zero-amount
    ///      payments (below) closes the cheap route independently, but the
    ///      namespace is the actual fix — without it, an attacker willing to
    ///      make a 1-unit payment could still grief.
    mapping(address payer => mapping(bytes32 nonce => bool used)) public usedNonces;

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
    error BatchTooLarge(uint256 length, uint256 max);
    error ZeroAmount();
    error DeadlineTooFar(uint256 deadline, uint256 max);

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
        if (ps.length > MAX_BATCH) revert BatchTooLarge(ps.length, MAX_BATCH);
        for (uint256 i = 0; i < ps.length; i++) {
            _execute(ps[i], payers[i], signatures[i]);
        }
    }

    function _execute(Payment calldata p, address payer, bytes calldata signature) internal {
        if (p.recipient == address(0)) revert ZeroAddress();
        // A zero-amount authorization moves nothing. It used to be accepted:
        // it passed the fee check (0 <= 0), consumed a nonce, and emitted a
        // PaymentExecuted event that every downstream indexer would faithfully
        // record as a settlement. Rejecting it removes a free write to shared
        // state and stops a payment-shaped log entry for a payment that never
        // happened.
        if (p.amount == 0) revert ZeroAmount();
        if (block.timestamp > p.deadline) revert AuthorizationExpired(p.deadline);
        if (p.deadline > block.timestamp + MAX_DEADLINE_WINDOW) {
            revert DeadlineTooFar(p.deadline, block.timestamp + MAX_DEADLINE_WINDOW);
        }
        if (usedNonces[payer][p.nonce]) revert NonceAlreadyUsed(p.nonce);
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

        // Set AFTER signature recovery, so the nonce is only ever consumed by
        // the address that actually signed this authorization.
        usedNonces[payer][p.nonce] = true;

        // slither-disable-start arbitrary-send-erc20
        // Not arbitrary: `payer` is cryptographically bound above — ECDSA.recover
        // over the EIP-712 Payment digest must equal `payer` (revert otherwise),
        // so funds only ever move from an address that signed THIS exact payment
        // (recipient/amount/fee/nonce/deadline). This is the meta-transaction
        // pattern (cf. EIP-3009); Slither can't see the signature binds `from`.
        usdc.safeTransferFrom(payer, p.recipient, p.amount - p.fee);
        if (p.fee > 0) {
            usdc.safeTransferFrom(payer, feeTreasury, p.fee);
        }
        // slither-disable-end arbitrary-send-erc20

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
