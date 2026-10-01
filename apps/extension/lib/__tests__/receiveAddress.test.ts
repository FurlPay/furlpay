import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import {
  EIP1193_UNAUTHORIZED,
  NO_LINKED_WALLET_ERROR,
  payableAddressFrom,
} from "../receiveAddress";

// T-E1 (audit P0-3): the extension never presents a keyless address as the
// user's wallet — not in the Receive sheet, not to a dapp via EIP-1193.

const LINKED = "0x1111111111111111111111111111111111111111";

describe("payableAddressFrom", () => {
  it("returns the verified, active, EVM linked wallet", () => {
    expect(payableAddressFrom({ linked: { address: LINKED, chainFamily: "evm", status: "active" } })).toEqual({
      ok: true,
      address: LINKED,
    });
  });

  it.each([
    ["no link", { linked: null }, "no_wallet_linked"],
    ["null response", null, "no_wallet_linked"],
    ["revoked link", { linked: { address: LINKED, chainFamily: "evm", status: "revoked" } }, "link_not_active"],
    ["non-EVM link", { linked: { address: LINKED, chainFamily: "solana", status: "active" } }, "unsupported_chain"],
    ["malformed", { linked: { address: "0x123", chainFamily: "evm", status: "active" } }, "invalid_address"],
  ] as const)("%s → no address (%s)", (_label, res, reason) => {
    expect(payableAddressFrom(res as never)).toEqual({ ok: false, reason });
  });

  it("uses the EIP-1193 'unauthorized' code for the no-wallet rejection", () => {
    expect(EIP1193_UNAUTHORIZED).toBe(4100);
  });
});

describe("tripwire: no safeAddress in executable extension code", () => {
  const ROOT = join(__dirname, "..", "..");
  const DIRS = ["entrypoints", "lib", "components"];
  function walk(dir: string, out: string[] = []): string[] {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return out;
    }
    for (const name of names) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "node_modules") continue;
        walk(full, out);
      } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }
  // Strip block and line comments so documentation of the bug may name it.
  const code = (f: string) =>
    readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("no file reads or renders `safeAddress`", () => {
    const hits = DIRS.flatMap((d) => walk(join(ROOT, d)))
      .filter((f) => /safeAddress/.test(code(f)))
      .map((f) => relative(ROOT, f).split(sep).join("/"));
    expect(hits).toEqual([]);
  });

  it("the provider maps NO_LINKED_WALLET to 4100 instead of inventing an account", () => {
    const provider = code(join(ROOT, "entrypoints", "wallet-announce.content.ts"));
    expect(provider).toContain("NO_LINKED_WALLET_ERROR");
    expect(provider).toContain("EIP1193_UNAUTHORIZED");
    const bg = code(join(ROOT, "entrypoints", "background.ts"));
    expect(bg).toContain("/api/wallet/link");
    expect(bg).not.toMatch(/"\/api\/wallets"\)\.then\(\(w\) => \(\{ accounts/);
    expect(NO_LINKED_WALLET_ERROR).toBe("NO_LINKED_WALLET");
  });
});
