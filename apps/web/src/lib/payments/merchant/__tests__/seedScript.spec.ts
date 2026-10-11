import { describe, expect, it } from "vitest";
import { verifyMessage } from "viem";
import { registrationMessage } from "../destinationMessage";
// @ts-expect-error -- plain .mjs operator script, no type declarations
import * as seed from "../../../../../scripts/seed-pilot-destinations.mjs";

// The pilot seed script must sign the exact bytes the operator console verifies.
// Hardhat's PUBLIC development mnemonic — never holds anything real.
const MNEMONIC = "test test test test test test test test test test test junk";
const M = "11111111-1111-4111-8111-111111111111";

describe("seed-pilot-destinations.mjs", () => {
  it("builds the same registration message as the app", () => {
    expect(seed.registrationMessage(M, "base", "0xabc", "ref")).toBe(registrationMessage(M, "base", "0xabc", "ref"));
  });
  it("produces signatures the app's verification accepts", async () => {
    const rows = await seed.buildDestinations({ mnemonic: MNEMONIC, merchantId: M, chains: ["base"], count: 2 });
    expect(rows.map((r: { address: string }) => r.address)).toEqual(["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"]);
    for (const r of rows) expect(await verifyMessage({ address: r.address, message: registrationMessage(M, r.chain, r.address, r.custody_reference), signature: r.signature })).toBe(true);
  });
  it("refuses production, Solana, and missing mnemonics", async () => {
    expect(() => seed.assertNotProduction({ SUPABASE_URL: "https://iyarllmcednkbekweucd.supabase.co" })).toThrow("PRODUCTION");
    expect(() => seed.parseArgs([`--merchant=${M}`, "--chains=solana"])).toThrow("unsupported");
    expect(() => seed.parseArgs(["--merchant=nope"])).toThrow("--merchant");
    await expect(seed.buildDestinations({ mnemonic: "", merchantId: M, chains: ["base"], count: 1 })).rejects.toThrow("mnemonic you control");
  });
});
