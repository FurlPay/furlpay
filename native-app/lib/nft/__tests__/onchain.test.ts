import { encodeNftTransfer, NftError, NFT_SELECTORS, tokenIdWord } from "../onchain";

// ---------------------------------------------------------------------------
// Transfer encoding.
//
// A wrong byte here does not throw — it produces a valid transaction that moves
// the wrong token, moves it to the wrong address, or reverts after the user
// paid gas and was told it worked. There is no runtime check downstream that
// catches any of those, so this file is the check.
// ---------------------------------------------------------------------------

const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";

const word = (hex: string) => hex.padStart(64, "0");
const addr = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");

describe("tokenIdWord", () => {
  it("encodes ordinary ids", () => {
    expect(tokenIdWord("1")).toBe(word("1"));
    expect(tokenIdWord("255")).toBe(word("ff"));
  });

  // Several major collections use a hash as the token id. Parsed as a JS number
  // those round, and a rounded id addresses a DIFFERENT token — one the user
  // does not own, so the transfer reverts after they paid for it.
  it("stays exact far above 2^53", () => {
    const huge = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    expect(tokenIdWord(huge)).toBe("f".repeat(64));
    expect(tokenIdWord("9007199254740993")).toBe(word((9007199254740993n).toString(16)));
  });

  it("refuses a negative, an overflow and junk", () => {
    expect(() => tokenIdWord("-1")).toThrow(NftError);
    expect(() => tokenIdWord((1n << 256n).toString())).toThrow(NftError);
    expect(() => tokenIdWord("abc")).toThrow(NftError);
    expect(() => tokenIdWord("")).toThrow(NftError);
  });
});

describe("encodeNftTransfer — ERC-721", () => {
  it("builds safeTransferFrom(address,address,uint256)", () => {
    const data = encodeNftTransfer({ standard: "erc721", from: FROM, to: TO, tokenId: "42" });
    expect(data).toBe(`${NFT_SELECTORS.safeTransferFrom721}${addr(FROM)}${addr(TO)}${word("2a")}`);
    // selector + exactly three words.
    expect(data.length).toBe(10 + 64 * 3);
  });

  // safeTransferFrom, never transferFrom: the safe variant reverts when the
  // recipient is a contract that cannot handle NFTs. transferFrom succeeds and
  // strands the token permanently.
  it("uses the SAFE selector", () => {
    const unsafe = "0x23b872dd"; // transferFrom(address,address,uint256)
    expect(NFT_SELECTORS.safeTransferFrom721).not.toBe(unsafe);
    expect(encodeNftTransfer({ standard: "erc721", from: FROM, to: TO, tokenId: "1" })).not.toContain(unsafe);
  });

  it("ignores an amount, which ERC-721 has no concept of", () => {
    const a = encodeNftTransfer({ standard: "erc721", from: FROM, to: TO, tokenId: "1" });
    const b = encodeNftTransfer({ standard: "erc721", from: FROM, to: TO, tokenId: "1", amount: "5" });
    expect(a).toBe(b);
  });

  it("rejects malformed addresses rather than encoding them", () => {
    expect(() => encodeNftTransfer({ standard: "erc721", from: "0xnope", to: TO, tokenId: "1" })).toThrow(NftError);
    expect(() => encodeNftTransfer({ standard: "erc721", from: FROM, to: "0x123", tokenId: "1" })).toThrow(NftError);
  });
});

describe("encodeNftTransfer — ERC-1155", () => {
  it("builds safeTransferFrom(address,address,uint256,uint256,bytes)", () => {
    const data = encodeNftTransfer({ standard: "erc1155", from: FROM, to: TO, tokenId: "7", amount: "3" });
    expect(data).toBe(
      `${NFT_SELECTORS.safeTransferFrom1155}${addr(FROM)}${addr(TO)}${word("7")}${word("3")}${word("a0")}${word("0")}`,
    );
  });

  // The dynamic `bytes` tail. Five head words means the data begins at 0xa0
  // (160). Writing 0 there — the common mistake — points the decoder at the
  // selector and the call reverts with no useful message.
  it("points the bytes offset at 160, not 0", () => {
    const data = encodeNftTransfer({ standard: "erc1155", from: FROM, to: TO, tokenId: "1", amount: "1" });
    const offsetWord = data.slice(10 + 64 * 4, 10 + 64 * 5);
    expect(BigInt(`0x${offsetWord}`)).toBe(160n);
    // …and a zero-length tail follows it.
    expect(BigInt(`0x${data.slice(10 + 64 * 5, 10 + 64 * 6)}`)).toBe(0n);
  });

  it("defaults the amount to one", () => {
    const data = encodeNftTransfer({ standard: "erc1155", from: FROM, to: TO, tokenId: "1" });
    expect(BigInt(`0x${data.slice(10 + 64 * 3, 10 + 64 * 4)}`)).toBe(1n);
  });

  it("refuses a zero or negative amount", () => {
    for (const amount of ["0", "-1"]) {
      expect(() =>
        encodeNftTransfer({ standard: "erc1155", from: FROM, to: TO, tokenId: "1", amount }),
      ).toThrow(NftError);
    }
  });

  it("produces a different payload from the ERC-721 encoding", () => {
    // Sending an 1155 with a 721 encoding calls a function that does not exist
    // on the contract; the two must never collide.
    const a = encodeNftTransfer({ standard: "erc721", from: FROM, to: TO, tokenId: "1" });
    const b = encodeNftTransfer({ standard: "erc1155", from: FROM, to: TO, tokenId: "1" });
    expect(a.slice(0, 10)).not.toBe(b.slice(0, 10));
  });
});

describe("selectors are computed from signatures", () => {
  // Pinned against the published four-byte values. Computed at runtime from the
  // signature, so this catches a typo in the SIGNATURE — which a hand-pasted
  // constant could never reveal.
  it("match the known ERC-721 / ERC-1155 selectors", () => {
    expect(NFT_SELECTORS.safeTransferFrom721).toBe("0x42842e0e");
    expect(NFT_SELECTORS.safeTransferFrom1155).toBe("0xf242432a");
    expect(NFT_SELECTORS.ownerOf).toBe("0x6352211e");
    expect(NFT_SELECTORS.balanceOf1155).toBe("0x00fdd58e");
    expect(NFT_SELECTORS.supportsInterface).toBe("0x01ffc9a7");
  });
});
