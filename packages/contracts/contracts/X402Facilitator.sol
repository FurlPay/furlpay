// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @dev The EIP-3009 surface of Circle's USDC (FiatTokenV2). Authorizations
///      are signed against the token's own domain, so this facilitator never
///      holds funds or keys — it forwards and indexes.
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

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}

/// @title X402Facilitator
/// @notice On-chain settlement leg of Furlpay's x402 facilitator on Arbitrum
///         One — the L2 with the deepest stablecoin liquidity. An AI agent
///         signs an EIP-3009 USDC authorization (the X-PAYMENT header
///         payload); the facilitator submits it and emits an indexed
///         settlement record that GET /api/x402/settlement/:tx serves back
///         to agents. Unlike hosted facilitators, settlements are indexed
///         on-chain and bound to the resource they paid for.
contract X402Facilitator is Ownable2Step, Pausable {
    IERC3009 public immutable usdc;

    struct Settlement {
        address payer;
        address payTo;
        uint256 amount;
        bytes32 resourceHash; // keccak256 of the resource URL the payment bought
        uint64 settledAt;
    }

    /// @dev nonce → settlement; the EIP-3009 nonce is unique per payer, and
    ///      USDC itself enforces single use, so this doubles as a replay log.
    mapping(bytes32 nonce => Settlement) public settlements;

    event X402Settled(
        address indexed payer,
        address indexed payTo,
        uint256 amount,
        bytes32 indexed resourceHash,
        bytes32 nonce
    );

    error AlreadySettled(bytes32 nonce);

    constructor(address usdc_, address owner_) Ownable(owner_) {
        usdc = IERC3009(usdc_);
    }

    /// @notice Settle a verified x402 payment. The signature is checked by
    ///         USDC against the payer, so the facilitator adds no trust
    ///         assumptions — it can't move funds the payer didn't authorize.
    /// @param resourceHash keccak256(resource URL) binding payment → resource.
    function settle(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes32 resourceHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused {
        if (settlements[nonce].settledAt != 0) revert AlreadySettled(nonce);

        // Reverts inside USDC on bad signature, expired window or used nonce.
        usdc.transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s);

        settlements[nonce] = Settlement({
            payer: from,
            payTo: to,
            amount: value,
            resourceHash: resourceHash,
            settledAt: uint64(block.timestamp)
        });

        emit X402Settled(from, to, value, resourceHash, nonce);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
