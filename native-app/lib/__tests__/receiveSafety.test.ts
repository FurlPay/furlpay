import { readFileSync } from "fs";
import { join } from "path";

// Source-level regression tripwire for the P0 money-loss bug: the Receive
// screen must derive its deposit address ONLY from the device wallet
// (lib/wallet.ts) and must never render `safeAddress` — server-side that value
// is a sha256-derived placeholder no private key controls, so funds sent to it
// are unrecoverable. A component render test can't catch a re-introduced
// `safeAddress` binding as reliably as reading the source that ships.

const receiveSrc = readFileSync(join(__dirname, "..", "..", "app", "receive.tsx"), "utf8");
// Comments may (and do) explain WHY safeAddress is banned — only code counts.
const receiveCode = receiveSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("receive screen safety (BUG 1)", () => {
  it("never references safeAddress in code", () => {
    expect(receiveCode).not.toMatch(/safeAddress/);
  });

  it("does not read the overview/profile for an address at all", () => {
    expect(receiveSrc).not.toMatch(/useOverview|\/profile/);
  });

  it("sources the address from the device wallet lib", () => {
    expect(receiveSrc).toMatch(/from "@\/lib\/wallet"/);
    expect(receiveSrc).toMatch(/getKnownAddress/);
    expect(receiveSrc).toMatch(/hasWallet/);
  });

  it("QR encodes the same state value that is rendered as text", () => {
    // Both the QRCode and the visible text bind to state.address — the QR can
    // never encode something different from what the user is shown.
    expect(receiveSrc).toMatch(/QRCode value=\{state\.address\}/);
    expect(receiveSrc).toMatch(/\{state\.address\}\s*<\/Text>/);
  });

  it("copy action copies the exact rendered address", () => {
    expect(receiveSrc).toMatch(/Clipboard\.setStringAsync\(state\.address\)/);
  });

  it("offers wallet creation instead of any fallback address when no wallet exists", () => {
    expect(receiveSrc).toMatch(/No wallet on this device/);
    expect(receiveSrc).toMatch(/router\.push\("\/wallet"\)/);
  });

  it("makes no unproven 'gas-free deposits' claim", () => {
    expect(receiveSrc).not.toMatch(/[Gg]as-free deposits/);
  });

  it("states the exact supported asset + network", () => {
    expect(receiveSrc).toMatch(/Arbitrum One/);
    expect(receiveSrc).toMatch(/USDC/);
  });
});
