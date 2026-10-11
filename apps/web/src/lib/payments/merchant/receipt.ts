import { displayUsdc } from "./money";
import { paymentChain } from "./registry";
import { isPaid, type MerchantIntent, type MerchantLink } from "./model";

// Payment receipts as a one-page PDF, without a PDF dependency: a single text
// page in the standard Helvetica font (no embedding), with a correct xref table.
// Issued ONLY for a payment the verifier credited (paid / overpaid); an
// underpaid, confirming or held payment has no receipt, so nothing unconfirmed
// can be printed as paid.
export class ReceiptUnavailable extends Error {}

/** PDF string literal: printable ASCII only (Helvetica/WinAnsi), with \ ( ) escaped. */
function pdfText(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
}

export function buildPdf(lines: { text: string; size?: number; gap?: number }[]): Uint8Array {
  let y = 790; const ops: string[] = ["BT", "/F1 11 Tf"];
  for (const l of lines) {
    const size = l.size ?? 11; y -= l.gap ?? size + 7;
    ops.push(`/F1 ${size} Tf`, `1 0 0 1 56 ${y} Tm`, `(${pdfText(l.text)}) Tj`);
  }
  ops.push("ET");
  const stream = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n"; const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

export function receiptPdf(intent: MerchantIntent, link: Pick<MerchantLink, "merchant_name" | "title" | "reference" | "kind">, receipts: { tx_hash: string; amount_units: string; observed_at: string }[], audience: "merchant" | "payer"): Uint8Array {
  if (!isPaid(intent.status) || !intent.paid_at) throw new ReceiptUnavailable("A receipt is available once the payment is verified as paid");
  const c = paymentChain(intent.chain);
  const lines: { text: string; size?: number; gap?: number }[] = [
    { text: link.merchant_name, size: 18, gap: 0 },
    { text: "Payment receipt", size: 13 },
    { text: `${link.kind === "invoice" ? "Invoice" : "Payment"}: ${link.title}${link.reference ? ` (ref ${link.reference})` : ""}`, gap: 30 },
    { text: `Payment ID: ${intent.id}` },
    { text: `Status: ${intent.status === "overpaid" ? "Paid (overpaid; excess held for refund)" : "Paid"}, verified on-chain` },
    { text: `Paid at: ${new Date(intent.paid_at).toISOString().replace("T", " ").slice(0, 19)} UTC` },
    { text: `Amount charged: ${displayUsdc(intent.charge_units)} USDC`, gap: 26 },
    { text: `Total received: ${displayUsdc(intent.received_units)} USDC` },
    ...(audience === "merchant" ? [
      { text: `Processing fee: ${displayUsdc(intent.fee_units)} USDC` },
      { text: `Merchant net: ${displayUsdc(intent.net_units)} USDC` },
    ] : []),
    { text: `Network: ${c.name} (native USDC ${c.token.length > 46 ? c.token.slice(0, 20) + "..." : c.token})`, gap: 26 },
    { text: `Paid to: ${intent.recipient}` },
    ...receipts.map((r, n) => ({ text: `Transaction ${n + 1}: ${r.tx_hash} (${displayUsdc(r.amount_units)} USDC)` })),
    { text: "This receipt reflects the payment as verified on-chain by FurlPay. The blockchain transaction is the definitive record.", size: 8, gap: 34 },
  ];
  return buildPdf(lines);
}
