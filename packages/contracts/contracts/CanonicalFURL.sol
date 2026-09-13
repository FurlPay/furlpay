// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

/**
 * @title Canonical FURL (EVM spoke)
 * @notice The EVM representation of FURL, whose canonical supply lives on
 *         Solana as a Token-2022 mint. Deployed once per spoke chain and
 *         minted/burned exclusively by a bridge manager (Wormhole NTT or
 *         LayerZero OFT) operating in burn-and-mint mode.
 *
 * @dev SUPPLY MODEL. Solana is the hub. FURL is locked in a vault there and
 *      minted here; burned here and unlocked there. The invariant the whole
 *      design exists to preserve is:
 *
 *          sum(EVM supply across all spokes) == FURL locked on Solana
 *          Solana circulating + Solana locked == 1,000,000,000
 *
 *      Nothing in this contract can verify the Solana side. What it CAN do is
 *      refuse to mint more than the canonical supply, which is the difference
 *      between a bridge bug costing a reconciliation and costing the cap.
 */
contract CanonicalFURL is ERC20, ERC20Permit, AccessControlDefaultAdminRules {
    /// @notice Held by the bridge manager. The only role that can create supply.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /**
     * @notice Hard ceiling on this chain's supply: the entire canonical supply.
     *
     * @dev WHY THIS EXISTS. A burn-and-mint bridge grants a contract the power
     *      to mint. If that manager is compromised or has a bug, an unbounded
     *      `mint` prints FURL that no locked Solana balance backs — the token
     *      then has more supply than its own stated cap, and the 1B figure
     *      published on /token becomes false everywhere.
     *
     *      The cap cannot make the accounting correct (only reconciliation
     *      against the Solana vault does that), but it bounds the damage at the
     *      one number that is definitionally impossible to exceed honestly.
     *      1e9 tokens at 6 decimals = 1e15 base units.
     */
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10 ** 6;

    error ExceedsCanonicalSupply(uint256 requested, uint256 remaining);
    error ZeroAddress();
    error ZeroAmount();

    /**
     * @param admin Receives DEFAULT_ADMIN_ROLE. Should be a multisig, never an
     *        EOA — it can grant MINTER_ROLE, which is the power to create supply.
     * @param adminTransferDelay Seconds a pending admin handover must wait.
     *        AccessControlDefaultAdminRules makes the transfer two-step and
     *        time-delayed, so a mistyped or malicious handover is visible and
     *        cancellable rather than instant and final.
     */
    constructor(address admin, uint48 adminTransferDelay)
        ERC20("FurlPay", "FURL")
        ERC20Permit("FurlPay")
        AccessControlDefaultAdminRules(adminTransferDelay, admin)
    {
        if (admin == address(0)) revert ZeroAddress();
    }

    /**
     * @notice Six decimals, matching the Solana Token-2022 mint exactly.
     *
     * @dev NOT 18. A bridge that mints 18-decimal tokens against a 6-decimal
     *      source moves 10^12 times the intended amount, and the error looks
     *      like an ordinary number the whole way. This is the single most
     *      consequential line in the file.
     */
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice FURL still mintable on this chain before the canonical cap.
    function remainingMintable() public view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }

    /**
     * @notice Mint bridged FURL. Bridge manager only.
     * @dev Reverts past MAX_SUPPLY rather than truncating or wrapping.
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 remaining = remainingMintable();
        if (amount > remaining) revert ExceedsCanonicalSupply(amount, remaining);

        _mint(to, amount);
    }

    /// @notice Burn your own FURL. This is what the bridge manager calls after
    ///         taking custody of the tokens it is bridging out.
    function burn(uint256 amount) external {
        _burn(_msgSender(), amount);
    }

    /**
     * @notice Burn from an account that has approved the caller.
     *
     * @dev ALLOWANCE-CHECKED, DELIBERATELY. An earlier design gave a BURNER_ROLE
     *      the power to burn any holder's balance without approval. That is a
     *      permanent-delegate in all but name — and FURL's Solana mint
     *      specifically OMITS the `permanentDelegate` extension, on the grounds
     *      that no one should be able to move or destroy a holder's tokens.
     *      Granting that power on the EVM side would contradict the token's own
     *      security posture on its home chain, where holders can verify its
     *      absence.
     *
     *      Burn-and-mint does not need it: the bridge manager takes the tokens
     *      via `transferFrom` (which the user approved) and then burns its own
     *      balance with `burn`.
     */
    function burnFrom(address account, uint256 amount) external {
        _spendAllowance(account, _msgSender(), amount);
        _burn(account, amount);
    }
}
