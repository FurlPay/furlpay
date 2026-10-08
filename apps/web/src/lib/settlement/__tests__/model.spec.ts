import { describe, expect, it } from "vitest";
import {
  approvalTier,
  draftSchema,
  invoiceTotals,
  minorUnits,
  moneySchema,
  parseCsv,
  validateBatch,
  validateDestination,
} from "../model";

const address = "0x1111111111111111111111111111111111111111";
const invoice = {
  kind: "invoice",
  name: "Retainer",
  customer: "Studio",
  asset: "USDC",
  dueDate: "2026-10-30",
  discountBps: 1000,
  note: "",
  lines: [
    { description: "Services", quantity: 3, unitPrice: "19.99", taxBps: 1800 },
  ],
};

describe("settlement draft boundaries", () => {
  it.each([
    "0",
    "-1",
    "1e3",
    "Infinity",
    "NaN",
    "1.001",
    "1000000.01",
    "01.20",
    " 5",
    "1,000",
  ])("rejects invalid money %s", (value) =>
    expect(moneySchema.safeParse(value).success).toBe(false)
  );
  it.each(["0.01", "19.99", "1000000.00"])(
    "accepts bounded decimal money %s",
    (value) => expect(moneySchema.safeParse(value).success).toBe(true)
  );
  it("rounds each discounted line and its tax in minor units", () => {
    expect(invoiceTotals(invoice.lines, 1000)).toEqual({
      subtotal: 5997,
      discount: 600,
      tax: 971,
      total: 6368,
    });
    expect(minorUnits("19.99")).toBe(1999);
  });
  it("bounds the complete invoice, not just each unit price", () => {
    expect(draftSchema.safeParse(invoice).success).toBe(true);
    expect(
      draftSchema.safeParse({
        ...invoice,
        lines: [{ ...invoice.lines[0], unitPrice: "1000000", quantity: 2 }],
      }).success
    ).toBe(false);
  });
  it("rejects malformed/empty dates and invalid numeric editor states without throwing", () => {
    expect(
      draftSchema.safeParse({ ...invoice, dueDate: "2026-02-30" }).success
    ).toBe(false);
    expect(
      draftSchema.safeParse({
        ...invoice,
        lines: [{ ...invoice.lines[0], quantity: -1 }],
      }).success
    ).toBe(false);
    expect(() =>
      invoiceTotals([{ ...invoice.lines[0], quantity: NaN }])
    ).toThrow();
  });
  it("rejects authority fields and never accepts an active rule", () => {
    const rule = {
      kind: "rule",
      name: "Split",
      network: "arbitrum",
      allocations: [
        { label: "Treasury", percentage: 80 },
        { label: "Reserve", percentage: 20 },
      ],
    };
    expect(draftSchema.safeParse(rule).success).toBe(true);
    expect(draftSchema.safeParse({ ...rule, active: true }).success).toBe(
      false
    );
    expect(
      draftSchema.safeParse({
        ...rule,
        allocations: [
          { label: "Treasury", percentage: 70 },
          { label: "Reserve", percentage: 20 },
        ],
      }).success
    ).toBe(false);
    expect(
      draftSchema.safeParse({
        ...invoice,
        owner_id: "someone-else",
        status: "paid",
      }).success
    ).toBe(false);
  });
  it("enforces fixed/open link amount invariants", () => {
    const link = {
      kind: "link",
      name: "Membership",
      mode: "fixed",
      asset: "USDC",
      network: "base",
      expiresOn: "2026-12-31",
      note: "",
    };
    expect(draftSchema.safeParse(link).success).toBe(false);
    expect(draftSchema.safeParse({ ...link, amount: "5.00" }).success).toBe(
      true
    );
    expect(
      draftSchema.safeParse({ ...link, mode: "open", amount: "5.00" }).success
    ).toBe(false);
    expect(draftSchema.safeParse({ ...link, mode: "open" }).success).toBe(true);
  });
  it("validates destinations for their chain family", async () => {
    expect(await validateDestination(address, "base")).toBe(true);
    expect(await validateDestination("0xabc", "base")).toBe(false);
    expect(
      await validateDestination("11111111111111111111111111111111", "solana")
    ).toBe(true);
    expect(await validateDestination(address, "solana")).toBe(false);
  });
  it("keeps threshold boundaries deterministic", () => {
    expect(approvalTier(1000).signatures).toBe(0);
    expect(approvalTier(1000.01).signatures).toBe(1);
    expect(approvalTier(10000).signatures).toBe(1);
    expect(approvalTier(10000.01).signatures).toBe(2);
    expect(approvalTier(100000).delayMinutes).toBe(0);
    expect(approvalTier(100000.01).delayMinutes).toBe(60);
  });
});

describe("payout CSV", () => {
  it("reads BOM, CRLF, embedded commas/newlines and escaped quotes", () => {
    expect(
      parseCsv('\uFEFFname,note\r\n"Smith, Alex","says ""hi""\nagain"\r\n')
    ).toEqual([
      ["name", "note"],
      ["Smith, Alex", 'says "hi"\nagain'],
    ]);
  });
  it("rejects malformed quoting", () => {
    expect(() => parseCsv('a,"unterminated')).toThrow();
    expect(() => parseCsv('"closed"oops,x')).toThrow();
  });
  it("reports row errors without presenting syntax as compliance", async () => {
    const rows = await validateBatch(
      `name,address,amount,network,reference\nValid,${address},10.25,arbitrum,INV-1\nBad,0xabc,-1,base,INV-2`
    );
    expect(rows[0].error).toBeUndefined();
    expect(rows[1].error).toContain("Invalid wallet address");
    expect(rows[1].error).toContain("Invalid amount");
    expect(rows[0]).not.toHaveProperty("screened");
  });
  it("caps payload size, row count and enforces column names", async () => {
    await expect(validateBatch("x".repeat(100001))).rejects.toThrow("100 KB");
    await expect(validateBatch("address,amount\nx,1")).rejects.toThrow(
      "columns"
    );
    await expect(
      validateBatch(
        `name,address,amount,network,reference\n${`Name,${address},1,base,ref\n`.repeat(
          101
        )}`
      )
    ).rejects.toThrow("100 recipients");
  });
});
