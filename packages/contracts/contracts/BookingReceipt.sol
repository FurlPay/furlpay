// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title BookingReceipt
/// @notice ERC-721 proof-of-purchase for Furlpay Travels bookings. Minted by
///         the escrow contract when a booking is funded; the tokenId is the
///         booking id, so a receipt is verifiable straight from the booking
///         reference. Metadata is served by the Furlpay API
///         (GET /api/travel/bookings/:id/receipt).
contract BookingReceipt is ERC721, Ownable2Step {
    address public minter; // FurlPayEscrow
    string public baseURI;

    event MinterUpdated(address indexed previousMinter, address indexed newMinter);

    error NotMinter(address caller);
    error ZeroAddress();

    constructor(address owner_, string memory baseURI_)
        ERC721("Furlpay Booking Receipt", "FURL-RCPT")
        Ownable(owner_)
    {
        baseURI = baseURI_;
    }

    function mint(address to, uint256 bookingTokenId) external {
        if (msg.sender != minter) revert NotMinter(msg.sender);
        _safeMint(to, bookingTokenId);
    }

    function setMinter(address newMinter) external onlyOwner {
        if (newMinter == address(0)) revert ZeroAddress();
        emit MinterUpdated(minter, newMinter);
        minter = newMinter;
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        baseURI = newBaseURI;
    }

    function _baseURI() internal view override returns (string memory) {
        return baseURI;
    }
}
