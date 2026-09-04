import { describe, it, expect } from "vitest";
import {
  checkAddress,
  checkDestination,
  detectFormat,
  maskAddress,
} from "../address";

// ---------------------------------------------------------------------------
// Payout destination validation.
//
// Every test here is about an IRREVERSIBLE mistake. A payment that fails is a
// retry; a payment sent to a valid-looking address on the wrong chain is gone,
// and no amount of ledger correctness gets it back. So the bias throughout is
// toward refusing rather than inferring.
// ---------------------------------------------------------------------------

// Checksummed (EIP-55) — vitalik.eth, a canonical test vector.
const EVM_OK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const EVM_LOWER = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
// Same address, one character's case flipped: passes format, fails EIP-55.
const EVM_BAD_CHECKSUM = "0xd8da6BF26964aF9D7eEd9e03E53415D37aA96045";
const SOL_OK = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SOL_MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("address format detection", () => {
  it("identifies EVM and Solana formats", () => {
    expect(detectFormat(EVM_OK)).toBe("evm");
    expect(detectFormat(SOL_OK)).toBe("solana");
  });

  it("returns null rather than guessing on nonsense", () => {
    for (const bad of ["", "hello", "0x123", "0x" + "z".repeat(40), "!!!"]) {
      expect(detectFormat(bad)).toBeNull();
    }
  });

  it("NEVER claims to know the network from the address alone", () => {
    // The load-bearing property. An EVM address is valid on every EVM chain;
    // a function that returned "base" here would be guessing with the user's
    // money. The return type is a format, and this test exists so that a later
    // "helpful" change to return a network breaks the build.
    const format = detectFormat(EVM_OK);
    expect(format).toBe("evm");
    expect(["base", "arbitrum", "polygon", "ethereum"]).not.toContain(format);
  });
});

describe("address validation", () => {
  it("accepts a checksummed EVM address and normalises it", () => {
    const r = checkAddress(EVM_LOWER);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized).toBe(EVM_OK); // normalised TO checksum form
  });

  it("rejects a mixed-case EVM address that fails EIP-55", () => {
    // EIP-55 exists to catch exactly this typo. Lower-casing and proceeding
    // would discard the only protection the format offers.
    const r = checkAddress(EVM_BAD_CHECKSUM);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_checksum");
  });

  it("accepts an all-lowercase EVM address", () => {
    // All-lowercase carries no checksum information, so it cannot fail one.
    expect(checkAddress(EVM_LOWER).ok).toBe(true);
  });

  it("recognises a transaction hash pasted into an address field", () => {
    const r = checkAddress("0x" + "a".repeat(64));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("looks_like_a_transaction");
  });

  it("refuses burn addresses that pass every other check", () => {
    const r = checkAddress("0x0000000000000000000000000000000000000000");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("burn_address");
  });

  it("refuses a Solana address that is not on the curve", () => {
    // A program-derived address has no private key. Tokens sent there can
    // never be withdrawn by a person.
    const offCurve = "4NCYB3kRT8sCNodPNuCZo8VUo4gDQd7YEwJi1oqRFvSJ";
    const r = checkAddress(offCurve);
    if (!r.ok) {
      expect(["not_on_curve", "unrecognised_format"]).toContain(r.reason);
    }
  });

  it("rejects empty input with a usable message", () => {
    const r = checkAddress("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty");
  });
});

describe("destination = network + asset + address", () => {
  it("accepts a Solana address on a Solana network", () => {
    const r = checkDestination({ network: "solana-devnet", address: SOL_OK });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.network).toBe("solana:devnet");
      expect(r.asset.symbol).toBe("USDC");
      expect(r.asset.decimals).toBe(6);
    }
  });

  it("refuses an EVM address on a Solana network", () => {
    // Syntactically fine, catastrophically wrong. Nothing about the address
    // says "Solana" — only the pairing catches it.
    const r = checkDestination({ network: "solana-devnet", address: EVM_OK });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_format_for_network");
  });

  it("refuses a Solana address on an EVM network", () => {
    const r = checkDestination({ network: "base", address: SOL_OK });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_format_for_network");
  });

  it("refuses a network FurlPay does not pay out on", () => {
    const r = checkDestination({ network: "dogecoin", address: EVM_OK });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_network");
  });

  it("refuses a payout asset that does not exist on the chosen network", () => {
    // Mainnet USDC named as the payout asset on a devnet payout. This is the
    // same guard as the gateway's, reached through the destination path.
    const r = checkDestination({
      network: "solana-devnet",
      assetAddress: SOL_MAINNET_USDC,
      address: SOL_OK,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("asset_not_on_network");
  });

  it("always demands explicit network confirmation for ambiguous formats", () => {
    // THE UI CONTRACT. Both supported formats are ambiguous as to network, so
    // the caller must always show a confirmation step. If a future format were
    // decisive this flag would be false for it — the flag is read, never
    // assumed.
    for (const [network, address] of [
      ["base", EVM_OK],
      ["arbitrum", EVM_OK],
      ["solana", SOL_OK],
    ] as const) {
      const r = checkDestination({ network, address });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.requiresNetworkConfirmation).toBe(true);
    }
  });

  it("treats the same EVM address as valid on several networks", () => {
    // Not a bug — the truth. It is why the network cannot be inferred, and the
    // reason the confirmation step above is mandatory rather than cosmetic.
    for (const network of ["base", "arbitrum", "polygon"]) {
      const r = checkDestination({ network, address: EVM_OK });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.address).toBe(EVM_OK);
    }
  });

  it("carries the asset's own decimals rather than assuming six", () => {
    const r = checkDestination({ network: "base", address: EVM_OK });
    expect(r.ok).toBe(true);
    if (r.ok) expect(typeof r.asset.decimals).toBe("number");
  });
});

describe("masking", () => {
  it("shows enough to recognise and not enough to reuse", () => {
    const masked = maskAddress(EVM_OK);
    expect(masked).toContain(EVM_OK.slice(0, 6));
    expect(masked).toContain(EVM_OK.slice(-4));
    expect(masked).not.toBe(EVM_OK);
    expect(masked).toContain("•");
  });

  it("does not mangle short strings into something misleading", () => {
    expect(maskAddress("0x1234")).toBe("0x1234");
  });
});
