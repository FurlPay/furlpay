import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  FURL_MINT,
  FURL_TOKEN_PROGRAM,
  SPL_TOKEN_PROGRAM,
  FURL_SYMBOL,
  FURL_NAME,
  FURL_DECIMALS,
  FURL_TOTAL_SUPPLY,
  FURL_TOTAL_SUPPLY_BASE_UNITS,
  FURL_METADATA_URI,
  FURL_IMAGE_URI,
  FURL_DEPLOYER,
  FURL_ALLOCATIONS,
  furlAllocationAmount,
  isFurlMint,
  assertFurlMint,
  isSolanaAddress,
  furlToBaseUnits,
  baseUnitsToFurl,
  formatFurl,
} from "@/lib/token/furl";

// ---------------------------------------------------------------------------
// FURL's identity and money math.
//
// Each block below is a way real value gets lost on a token integration: a
// second spelling of the mint address, a lookalike mint accepted as the real
// one, a float amount that drops a digit, or a page that claims a peg the chain
// does not implement.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const LAUNCH_CONFIG = join(REPO_ROOT, "packages", "furl-token", "src", "config.ts");
const LAUNCH_RECORD = join(REPO_ROOT, "packages", "furl-token", "MAINNET-LAUNCH.md");
const METADATA_MIRROR = join(REPO_ROOT, "apps", "web", "public", "furl", "metadata.json");

describe("FURL identity", () => {
  it("is the live mainnet mint, exactly", () => {
    expect(FURL_MINT).toBe("FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY1");
  });

  it("is Token-2022, NOT the legacy SPL Token program", () => {
    // Deriving an associated token account under the legacy program yields a
    // different address that no FURL transfer can ever reach.
    expect(FURL_TOKEN_PROGRAM).toBe("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    expect(FURL_TOKEN_PROGRAM).not.toBe(SPL_TOKEN_PROGRAM);
  });

  it("has 6 decimals and a 1,000,000,000 supply that agree in base units", () => {
    expect(FURL_DECIMALS).toBe(6);
    expect(FURL_TOTAL_SUPPLY).toBe(1_000_000_000);
    expect(FURL_TOTAL_SUPPLY_BASE_UNITS).toBe(
      BigInt(FURL_TOTAL_SUPPLY) * 10n ** BigInt(FURL_DECIMALS),
    );
    expect(FURL_TOTAL_SUPPLY_BASE_UNITS).toBe(1_000_000_000_000_000n);
  });

  it("names the token FurlPay / FURL", () => {
    expect(FURL_NAME).toBe("FurlPay");
    expect(FURL_SYMBOL).toBe("FURL");
  });

  it("points metadata and icon at permanent Arweave (Irys), not a mutable origin", () => {
    for (const uri of [FURL_METADATA_URI, FURL_IMAGE_URI]) {
      expect(uri).toMatch(/^https:\/\/gateway\.irys\.xyz\/[A-Za-z0-9_-]{40,}$/);
      expect(uri).not.toMatch(/furlpay\.com/);
    }
  });

  it("publishes only public addresses — never a secret", () => {
    for (const addr of [FURL_MINT, FURL_TOKEN_PROGRAM, FURL_DEPLOYER]) {
      expect(isSolanaAddress(addr)).toBe(true);
    }
    // A 64-byte secret-key array or a base58 seed would not match the pubkey
    // shape; this is the guard against one being pasted in by mistake.
    const source = readFileSync(join(__dirname, "..", "token", "furl.ts"), "utf8");
    expect(source).not.toMatch(/\b\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,/);
    expect(source).not.toMatch(/PRIVATE KEY|secretKey|mnemonic|seed phrase/i);
  });
});

describe("one source of truth for the mint", () => {
  it("agrees with the launch package config", () => {
    const launch = readFileSync(LAUNCH_CONFIG, "utf8");
    expect(launch).toContain(`MINT_ADDRESS = '${FURL_MINT}'`);
    expect(launch).toContain(`'${FURL_DEPLOYER}'`);
    expect(launch).toContain("decimals: 6");
  });

  it("agrees with the published launch record", () => {
    const record = readFileSync(LAUNCH_RECORD, "utf8");
    expect(record).toContain(FURL_MINT);
    expect(record).toContain("Decimals:** 6");
  });

  it("agrees with the public metadata mirror", () => {
    const mirror = JSON.parse(readFileSync(METADATA_MIRROR, "utf8"));
    expect(mirror.name).toBe(FURL_NAME);
    expect(mirror.symbol).toBe(FURL_SYMBOL);
    expect(mirror.image).toBe(FURL_IMAGE_URI);
  });

  // Same reason as domSinkInventory: a whole-repo scan against the 5s default.
  // Assertion unchanged; only the scan budget.
  it("has no OTHER mint-shaped FURL address anywhere in the web app", { timeout: 60_000 }, () => {
    // A stale address in a second file is the failure this guards: if someone
    // pastes a different mint into a component, this test names the file.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSyncSafe(dir)) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".next") continue;
          walk(full);
        } else if (/\.(ts|tsx|json|md)$/.test(entry.name)) {
          const text = readFileSync(full, "utf8");
          // "FURL" mentioned near a base58 address that is not our mint.
          for (const m of text.matchAll(/\bFURL[_A-Za-z]*\s*[:=]\s*["']([1-9A-HJ-NP-Za-km-z]{32,44})["']/g)) {
            const addr = m[1];
            if (addr !== FURL_MINT && addr !== FURL_TOKEN_PROGRAM && addr !== FURL_DEPLOYER) {
              offenders.push(`${full}: ${addr}`);
            }
          }
        }
      }
    };
    walk(join(REPO_ROOT, "apps", "web", "src"));
    expect(offenders).toEqual([]);
  });
});

function readdirSyncSafe(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

describe("mint validation", () => {
  it("accepts the real mint", () => {
    expect(isFurlMint(FURL_MINT)).toBe(true);
    expect(() => assertFurlMint(FURL_MINT)).not.toThrow();
  });

  it("rejects a lookalike mint", () => {
    // Same visual prefix, different address — the shape a spoof token takes.
    const lookalike = "FYatJq71zqvaQNLLtbBy4hQcsV25dMATYfCSVBzV3gY2";
    expect(isFurlMint(lookalike)).toBe(false);
    expect(() => assertFurlMint(lookalike)).toThrow(/Not the FURL mint/);
  });

  it("rejects a case-folded variant (base58 is case-sensitive)", () => {
    expect(isFurlMint(FURL_MINT.toLowerCase())).toBe(false);
    expect(isFurlMint(FURL_MINT.toUpperCase())).toBe(false);
  });

  it("rejects USDC, SOL's system program, and empty input", () => {
    for (const other of [
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "11111111111111111111111111111111",
      "",
    ]) {
      expect(isFurlMint(other)).toBe(false);
    }
  });

  it("rejects addresses with base58-illegal characters", () => {
    // 0, O, I and l are not in the base58 alphabet.
    expect(isSolanaAddress("0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl")).toBe(false);
  });
});

describe("allocation model", () => {
  it("sums to exactly 100%", () => {
    expect(FURL_ALLOCATIONS.reduce((a, b) => a + b.percent, 0)).toBe(100);
  });

  it("sums to exactly 1,000,000,000 FURL with no rounding loss", () => {
    const total = FURL_ALLOCATIONS.reduce((a, b) => a + furlAllocationAmount(b.percent), 0);
    expect(total).toBe(FURL_TOTAL_SUPPLY);
  });

  it("covers the six published buckets", () => {
    expect(FURL_ALLOCATIONS.map((a) => a.key)).toEqual([
      "community",
      "liquidity",
      "treasury",
      "team",
      "partnerships",
      "reserve",
    ]);
    expect(FURL_ALLOCATIONS.find((a) => a.key === "community")!.percent).toBe(40);
    expect(FURL_ALLOCATIONS.find((a) => a.key === "liquidity")!.percent).toBe(20);
  });
});

describe("amount conversion", () => {
  it("converts whole FURL to base units exactly", () => {
    expect(furlToBaseUnits("1")).toBe(1_000_000n);
    expect(furlToBaseUnits("0.000001")).toBe(1n);
    expect(furlToBaseUnits("12.5")).toBe(12_500_000n);
    expect(furlToBaseUnits(1_000_000_000n)).toBe(FURL_TOTAL_SUPPLY_BASE_UNITS);
  });

  it("REJECTS more precision than the mint has, instead of truncating", () => {
    // Truncating 0.0000005 to 0 is a payment that silently does nothing; it
    // must be an error the caller has to handle.
    expect(() => furlToBaseUnits("0.0000001")).toThrow(/decimal places/);
    expect(() => furlToBaseUnits("1.1234567")).toThrow(/decimal places/);
  });

  it("rejects non-numeric and negative input", () => {
    for (const bad of ["", "abc", "-1", "1e6", "1.2.3", " 1,000 "]) {
      expect(() => furlToBaseUnits(bad)).toThrow();
    }
  });

  it("round-trips through base units without float drift", () => {
    for (const amount of ["0", "1", "0.000001", "999999999.999999", "123456.654321"]) {
      expect(baseUnitsToFurl(furlToBaseUnits(amount))).toBe(
        // trailing zeros are not significant; "0" stays "0"
        amount.includes(".") ? amount.replace(/0+$/, "").replace(/\.$/, "") : amount,
      );
    }
  });

  it("survives amounts beyond Number.MAX_SAFE_INTEGER in base units", () => {
    // The whole supply in base units (1e15) is under MAX_SAFE_INTEGER, but a
    // float multiplication chain past it silently loses units. bigint does not.
    expect(baseUnitsToFurl(FURL_TOTAL_SUPPLY_BASE_UNITS)).toBe("1000000000");
    expect(formatFurl(FURL_TOTAL_SUPPLY_BASE_UNITS)).toBe("1,000,000,000");
    expect(baseUnitsToFurl("9007199254740993")).toBe("9007199254.740993");
  });

  it("formats for display with separators, keeping the fraction", () => {
    expect(formatFurl(1_234_567_000_000n)).toBe("1,234,567");
    expect(formatFurl(1_000_500n)).toBe("1.0005");
    expect(formatFurl(0n)).toBe("0");
  });
});
