// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IBookingReceipt {
    function mint(address to, uint256 bookingTokenId) external;
}

/// @title FurlPayEscrow
/// @notice Travel booking escrow on Arbitrum One. The traveler funds a
///         booking in USDC; funds sit in escrow until either
///           - the check-in oracle confirms check-in → provider is paid, or
///           - the traveler cancels before `cancellationDeadline` → refund, or
///           - `checkInDate + releaseGracePeriod` passes with no dispute →
///             anyone can release to the provider (provider isn't hostage to
///             a dead oracle).
///         Funding mints an ERC-721 BookingReceipt to the traveler.
contract FurlPayEscrow is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum BookingStatus {
        None,
        Funded,
        Released,
        Refunded
    }

    struct Booking {
        address traveler;
        address provider;
        uint256 amount; // USDC, 6 decimals
        uint64 checkInDate;
        uint64 cancellationDeadline;
        BookingStatus status;
    }

    IERC20 public immutable usdc;
    IBookingReceipt public immutable receipt;

    /// @notice Furlpay's check-in verification oracle (Chainlink adapter or
    ///         the platform operator until decentralized).
    address public checkInOracle;

    /// @notice After checkInDate + grace, release needs no oracle.
    uint64 public constant RELEASE_GRACE_PERIOD = 7 days;

    mapping(bytes32 bookingId => Booking) public bookings;

    event BookingFunded(
        bytes32 indexed bookingId,
        address indexed traveler,
        address indexed provider,
        uint256 amount,
        uint64 checkInDate,
        uint64 cancellationDeadline
    );
    event BookingReleased(bytes32 indexed bookingId, address indexed provider, uint256 amount);
    event BookingRefunded(bytes32 indexed bookingId, address indexed traveler, uint256 amount);
    event CheckInOracleUpdated(address indexed previousOracle, address indexed newOracle);

    error BookingExists(bytes32 bookingId);
    error BookingNotFunded(bytes32 bookingId);
    error NotOracle(address caller);
    error NotTraveler(address caller);
    error CancellationWindowClosed(uint64 deadline);
    error GracePeriodNotReached(uint64 releasableAt);
    error InvalidSchedule();
    error ZeroAddress();
    error ZeroAmount();

    constructor(address usdc_, address receipt_, address checkInOracle_, address owner_)
        Ownable(owner_)
    {
        if (usdc_ == address(0) || receipt_ == address(0) || checkInOracle_ == address(0)) {
            revert ZeroAddress();
        }
        usdc = IERC20(usdc_);
        receipt = IBookingReceipt(receipt_);
        checkInOracle = checkInOracle_;
    }

    /// @notice Fund a booking. Caller (the traveler) must have approved
    ///         `amount` USDC. Mints the booking receipt NFT to the traveler.
    function createBooking(
        bytes32 bookingId,
        uint256 amount,
        address provider,
        uint64 checkInDate,
        uint64 cancellationDeadline
    ) external nonReentrant whenNotPaused {
        if (bookings[bookingId].status != BookingStatus.None) revert BookingExists(bookingId);
        if (provider == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        // Cancellation must close at or before check-in, and check-in must be
        // in the future — otherwise the timelock math is meaningless.
        if (cancellationDeadline > checkInDate || checkInDate <= block.timestamp) {
            revert InvalidSchedule();
        }

        bookings[bookingId] = Booking({
            traveler: msg.sender,
            provider: provider,
            amount: amount,
            checkInDate: checkInDate,
            cancellationDeadline: cancellationDeadline,
            status: BookingStatus.Funded
        });

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        receipt.mint(msg.sender, uint256(bookingId));

        emit BookingFunded(bookingId, msg.sender, provider, amount, checkInDate, cancellationDeadline);
    }

    /// @notice Oracle-confirmed check-in → pay the provider.
    function confirmCheckIn(bytes32 bookingId) external nonReentrant {
        if (msg.sender != checkInOracle) revert NotOracle(msg.sender);
        _release(bookingId);
    }

    /// @notice Permissionless release once the grace period after check-in
    ///         has passed — protects providers from oracle downtime.
    function releaseAfterGrace(bytes32 bookingId) external nonReentrant {
        Booking storage b = bookings[bookingId];
        uint64 releasableAt = b.checkInDate + RELEASE_GRACE_PERIOD;
        if (block.timestamp < releasableAt) revert GracePeriodNotReached(releasableAt);
        _release(bookingId);
    }

    /// @notice Traveler cancels before the cancellation deadline → full refund.
    function cancel(bytes32 bookingId) external nonReentrant {
        Booking storage b = bookings[bookingId];
        if (b.status != BookingStatus.Funded) revert BookingNotFunded(bookingId);
        if (msg.sender != b.traveler) revert NotTraveler(msg.sender);
        if (block.timestamp > b.cancellationDeadline) {
            revert CancellationWindowClosed(b.cancellationDeadline);
        }

        b.status = BookingStatus.Refunded;
        usdc.safeTransfer(b.traveler, b.amount);
        emit BookingRefunded(bookingId, b.traveler, b.amount);
    }

    function _release(bytes32 bookingId) internal {
        Booking storage b = bookings[bookingId];
        if (b.status != BookingStatus.Funded) revert BookingNotFunded(bookingId);

        b.status = BookingStatus.Released;
        usdc.safeTransfer(b.provider, b.amount);
        emit BookingReleased(bookingId, b.provider, b.amount);
    }

    // --- Admin ---------------------------------------------------------------

    function setCheckInOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        emit CheckInOracleUpdated(checkInOracle, newOracle);
        checkInOracle = newOracle;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
