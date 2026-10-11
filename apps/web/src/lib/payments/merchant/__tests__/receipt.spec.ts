import { describe, expect, it } from "vitest";
import { buildPdf, receiptPdf, ReceiptUnavailable } from "../receipt";
import type { MerchantIntent } from "../model";

// Receipts are parsed back with a real PDF reader (pdf.js), not just string-matched.
async function textOf(pdf: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;
  expect(doc.numPages).toBe(1);
  const content = await (await doc.getPage(1)).getTextContent();
  return content.items.map(i => ("str" in i ? i.str : "")).join("\n");
}

const intent = (over: Partial<MerchantIntent> = {}): MerchantIntent => ({
  id: "11111111-1111-4111-8111-111111111111", link_id: "l", merchant_id: "m", chain: "base", recipient: "0x" + "ab".repeat(20), reference: "r",
  status: "paid", gross_units: "1000000000", fee_units: "7500000", charge_units: "1000000000", net_units: "992500000", received_units: "1000000000",
  start_block: "1", scan_block: "1", created_at: "2026-10-09T00:00:00Z", expires_at: "2026-10-09T00:30:00Z", paid_at: "2026-10-09T00:05:00Z",
  transaction_hash: "0x" + "9".repeat(64), confirmations: 1, ledger_tx_id: "t", ...over,
});
const link = { merchant_name: "Café (Acme) \\ Ltd", title: "Order 42", reference: "INV-42", kind: "invoice" as const };
const receipts = [{ tx_hash: "0x" + "9".repeat(64), amount_units: "1000000000", observed_at: "x" }];

describe("PDF receipts", () => {
  it("produces a valid PDF that a real reader parses, with the payment facts", async () => {
    const text = await textOf(receiptPdf(intent(), link, receipts, "merchant"));
    for (const s of ["Payment receipt", "Order 42", "INV-42", "11111111-1111-4111-8111-111111111111", "1000.00 USDC", "Processing fee: 7.50 USDC", "Merchant net: 992.50 USDC", "Base", "0x" + "9".repeat(64)]) expect(text).toContain(s);
    // Non-ASCII is replaced, and ( ) \ are escaped rather than breaking the content stream.
    expect(text).toContain("Caf? (Acme) \\ Ltd");
  });
  it("omits the merchant's fee and net on the payer's copy", async () => {
    const text = await textOf(receiptPdf(intent(), link, receipts, "payer"));
    expect(text).not.toContain("Processing fee");
    expect(text).not.toContain("Merchant net");
  });
  it.each(["awaiting_payment", "confirming", "underpaid", "review", "expired"] as const)("issues no receipt for a %s payment", (status) => {
    expect(() => receiptPdf(intent({ status, paid_at: null }), link, receipts, "payer")).toThrow(ReceiptUnavailable);
  });
  it("writes a correct cross-reference table", () => {
    const s = Buffer.from(buildPdf([{ text: "x" }])).toString("latin1");
    const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...s.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map(m => Number(m[1]));
    offsets.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
});
