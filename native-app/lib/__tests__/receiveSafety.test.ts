import { readFileSync } from "fs";
import { join } from "path";

// Source-level regression tripwire for the P0 money-loss bug: the Receive
// screen must derive its deposit address ONLY from the device wallet
// (lib/wallet.ts) and must never render `safeAddress` — server-side that value
// is a sha256-derived placeholder no private key controls, so funds sent to it
// are unrecoverable. A component render test can't catch a re-introduced
// `safeAddress` binding as reliably as reading the source that ships.

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const receiveSrc = readFileSync(join(__dirname, "..", "..", "app", "receive.tsx"), "utf8");
const receiveCode = strip(receiveSrc);

// The shareable QR card now owns the QR encoding, copy and share — so it is
// part of the receive path and inherits the same P0 rule: it may bind ONLY to
// the address it is handed (the device-wallet address receive.tsx passes), and
// must never reach for safeAddress or read the account overview itself.
const cardSrc = readFileSync(join(__dirname, "..", "..", "components", "WalletQrCard.tsx"), "utf8");
const cardCode = strip(cardSrc);

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

  it("binds the shareable QR card to the device address and shows it as text", () => {
    // receive.tsx hands WalletQrCard the SAME state.address it renders below,
    // so the QR, the copy action and the social share can only ever carry the
    // device-wallet address the user is shown.
    expect(receiveSrc).toMatch(/<WalletQrCard[^>]*address=\{state\.address\}/s);
    expect(receiveSrc).toMatch(/\{state\.address\}\s*<\/Text>/);
  });
});

describe("shareable QR card safety (BUG 1, extended)", () => {
  it("never references safeAddress", () => {
    expect(cardCode).not.toMatch(/safeAddress/);
  });

  it("does not read the overview/profile for an address of its own", () => {
    // Stripped of comments — the comments explain the ban, only code counts.
    expect(cardCode).not.toMatch(/useOverview|\/api\/overview|\/profile/);
  });

  it("QR encodes exactly the address prop it was handed", () => {
    expect(cardCode).toMatch(/value=\{address\}/);
  });

  it("copy and social share carry that same address, not a substitute", () => {
    expect(cardCode).toMatch(/Clipboard\.setStringAsync\(address\)/);
    // shareText is built from `address`, so every share path (sheet, WhatsApp,
    // Telegram, X) carries the device address.
    expect(cardCode).toMatch(/my wallet address: \$\{address\}/);
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
