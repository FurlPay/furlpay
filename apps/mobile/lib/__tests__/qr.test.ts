import { parseScannedAddress } from "../qr";

const EVM = "0x7045E4f6C1B5EDf8b0C6b9d3D6bE9E4E1FAAa31e";
const SOL = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";

describe("parseScannedAddress", () => {
  it("accepts a bare EVM address (with whitespace)", () => {
    expect(parseScannedAddress(`  ${EVM}  `)).toBe(EVM);
  });

  it("accepts a bare Solana address", () => {
    expect(parseScannedAddress(SOL)).toBe(SOL);
  });

  it("parses EIP-681 URIs and ignores extra params", () => {
    expect(parseScannedAddress(`ethereum:${EVM}@42161/transfer?value=1`)).toBe(EVM);
  });

  it("parses Solana Pay URIs", () => {
    expect(parseScannedAddress(`solana:${SOL}?amount=1&label=FurlPay`)).toBe(SOL);
  });

  it("extracts the address from furlpay.com payment links only", () => {
    expect(parseScannedAddress(`https://furlpay.com/pay?to=${EVM}`)).toBe(EVM);
    expect(parseScannedAddress(`https://www.furlpay.com/pay/${EVM}`)).toBe(EVM);
    // Other hosts must NOT be trusted as payment links.
    expect(parseScannedAddress(`https://evil.example.com/pay?to=${EVM}`)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parseScannedAddress("hello world")).toBeNull();
    expect(parseScannedAddress("0x1234")).toBeNull();
    expect(parseScannedAddress("")).toBeNull();
  });
});
