import { parseScannedAddress } from "../qr";

const EVM = "0x7045E4f6C1B5EDf8b0C6b9d3D6bE9E4E1FAAa31e";
const SOL = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";
/** USDC on Base — a token contract, i.e. never a payee. */
const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("parseScannedAddress", () => {
  it("accepts a bare EVM address (with whitespace)", () => {
    expect(parseScannedAddress(`  ${EVM}  `)).toBe(EVM);
  });

  it("accepts a bare Solana address", () => {
    expect(parseScannedAddress(SOL)).toBe(SOL);
  });

  it("parses a plain-value EIP-681 URI (target IS the payee)", () => {
    expect(parseScannedAddress(`ethereum:${EVM}`)).toBe(EVM);
    expect(parseScannedAddress(`ethereum:${EVM}@42161`)).toBe(EVM);
    expect(parseScannedAddress(`ethereum:${EVM}@42161?value=1e18`)).toBe(EVM);
  });

  // The target of an ERC-20 `transfer` call is the TOKEN CONTRACT, not the
  // payee. Returning it would send funds to the token itself — unrecoverable.
  it("takes the payee from `address` on an ERC-20 transfer, never the token", () => {
    expect(parseScannedAddress(`ethereum:${TOKEN}@1/transfer?address=${EVM}&uint256=1e6`)).toBe(EVM);
    expect(parseScannedAddress(`ethereum:${TOKEN}/transferFrom?address=${EVM}`)).toBe(EVM);
  });

  it("refuses a contract call it cannot attribute to a payee", () => {
    // transfer with no `address` param — we must NOT fall back to the token.
    expect(parseScannedAddress(`ethereum:${TOKEN}@1/transfer?uint256=1e6`)).toBeNull();
    // A malformed payee in `address` is not payable either.
    expect(parseScannedAddress(`ethereum:${TOKEN}@1/transfer?address=0xdead`)).toBeNull();
    // Unknown/arbitrary function calls are not payments.
    expect(parseScannedAddress(`ethereum:${TOKEN}@1/approve?address=${EVM}`)).toBeNull();
  });

  it("parses Solana Pay URIs", () => {
    expect(parseScannedAddress(`solana:${SOL}?amount=1&label=FurlPay`)).toBe(SOL);
  });

  it("extracts the address from furlpay.com payment links only", () => {
    expect(parseScannedAddress(`https://furlpay.com/pay?to=${EVM}`)).toBe(EVM);
    expect(parseScannedAddress(`https://www.furlpay.com/pay/${EVM}`)).toBe(EVM);
    expect(parseScannedAddress(`https://furlpay.com/pay?to=${SOL}`)).toBe(SOL);
    expect(parseScannedAddress(`https://www.furlpay.com/pay/${SOL}`)).toBe(SOL);
    // Other hosts must NOT be trusted as payment links.
    expect(parseScannedAddress(`https://evil.example.com/pay?to=${EVM}`)).toBeNull();
    // Phishing / parameter injection attempts must not trick the parser.
    expect(parseScannedAddress(`https://furlpay.com/pay?attacker=${EVM}&to=0x1111111111111111111111111111111111111111`)).toBe("0x1111111111111111111111111111111111111111");
    expect(parseScannedAddress(`https://furlpay.com/pay?to=0x1111111111111111111111111111111111111111&attacker=${EVM}`)).toBe("0x1111111111111111111111111111111111111111");
  });

  it("rejects garbage", () => {
    expect(parseScannedAddress("hello world")).toBeNull();
    expect(parseScannedAddress("0x1234")).toBeNull();
    expect(parseScannedAddress("")).toBeNull();
  });
});
