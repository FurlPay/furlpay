// ---------------------------------------------------------------------------
// E-Commerce plugin types for Shopify and WooCommerce integration.
//
// THE GAP: The audit identified that the e-commerce plugins lack:
// - Refund routing (partial and full refunds back through USDC)
// - Tax calculation integration
// - Webhook signature verification for platform callbacks
// - Order status synchronization
// ---------------------------------------------------------------------------

import * as crypto from "crypto";

export type EcommercePlatform = "shopify" | "woocommerce";

export type OrderStatus = 
  | "pending"       // Order created, payment not yet confirmed
  | "paid"          // Payment confirmed
  | "partially_refunded"
  | "refunded"      // Full refund issued
  | "cancelled"     // Order cancelled before fulfillment
  | "disputed";

export interface EcommerceOrder {
  platform: EcommercePlatform;
  externalOrderId: string;
  merchantId: string;
  status: OrderStatus;
  totalAmount: string;    // bigint minor units
  currency: string;       // ISO 4217
  paymentAsset: string;   // AssetId (e.g. "USDC.arbitrum")
  paymentChain: string;
  paymentTxHash?: string;
  items: OrderLineItem[];
  tax: TaxBreakdown;
  refunds: RefundRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderLineItem {
  name: string;
  quantity: number;
  unitPrice: string;      // bigint minor units
  taxRate: number;        // 0.0 to 1.0
  taxAmount: string;      // bigint minor units
}

export interface TaxBreakdown {
  subtotal: string;       // bigint minor units
  taxTotal: string;       // bigint minor units
  total: string;          // bigint minor units
  jurisdiction?: string;  // Tax jurisdiction code
  rate?: number;
}

export interface RefundRecord {
  id: string;
  amount: string;         // bigint minor units
  reason: string;
  type: "full" | "partial";
  status: "pending" | "processed" | "failed";
  txHash?: string;
  createdAt: string;
  processedAt?: string;
}

// Webhook verification for each platform
export interface WebhookConfig {
  platform: EcommercePlatform;
  secret: string;
  tolerance: number; // seconds for timestamp tolerance
}

/**
 * Verifies a Shopify webhook payload using HMAC-SHA256.
 * Shopify computes the HMAC using the app's client secret and the raw payload body.
 * @param rawBody The raw, unparsed request body text
 * @param hmacHeader The X-Shopify-Hmac-Sha256 header value (Base64)
 * @param secret The Shopify app client secret
 */
export function verifyShopifyWebhook(rawBody: string, hmacHeader: string, secret: string): boolean {
  if (!hmacHeader || !secret) return false;

  const generatedHash = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const generatedBuffer = Buffer.from(generatedHash, "utf8");
  const headerBuffer = Buffer.from(hmacHeader, "utf8");

  if (generatedBuffer.length !== headerBuffer.length) {
    return false;
  }

  // Use timingSafeEqual to prevent timing attacks (AGENTS.md rule 3)
  return crypto.timingSafeEqual(generatedBuffer, headerBuffer);
}

/**
 * Verifies a WooCommerce webhook payload using HMAC-SHA256.
 * WooCommerce sends the signature in the X-WC-Webhook-Signature header.
 * @param rawBody The raw, unparsed request body text
 * @param signatureHeader The X-WC-Webhook-Signature header value (Base64)
 * @param secret The webhook secret defined in WooCommerce
 */
export function verifyWooCommerceWebhook(rawBody: string, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader || !secret) return false;

  const generatedHash = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const generatedBuffer = Buffer.from(generatedHash, "utf8");
  const headerBuffer = Buffer.from(signatureHeader, "utf8");

  if (generatedBuffer.length !== headerBuffer.length) {
    return false;
  }

  // Use timingSafeEqual to prevent timing attacks (AGENTS.md rule 3)
  return crypto.timingSafeEqual(generatedBuffer, headerBuffer);
}

/**
 * Aggregates all line items to calculate the tax breakdown correctly.
 * Uses bigint string operations to avoid floating point math.
 */
export function buildTaxBreakdown(items: OrderLineItem[]): TaxBreakdown {
  let subtotal = 0n;
  let taxTotal = 0n;
  let total = 0n;

  for (const item of items) {
    const qty = BigInt(item.quantity);
    const unitPrice = BigInt(item.unitPrice);
    const taxAmt = BigInt(item.taxAmount);

    const lineSubtotal = unitPrice * qty;
    subtotal += lineSubtotal;
    taxTotal += taxAmt; // assuming taxAmount passed is already multiplied by qty or provided correctly
    total += lineSubtotal + taxAmt;
  }

  return {
    subtotal: subtotal.toString(),
    taxTotal: taxTotal.toString(),
    total: total.toString()
  };
}

/**
 * Validates if an order can be refunded and calculates the maximum eligible amount.
 */
export function canRefund(order: EcommerceOrder): { allowed: boolean; reason: string; maxAmount: string } {
  const totalAmount = BigInt(order.totalAmount);
  let totalRefunded = 0n;

  for (const refund of order.refunds) {
    if (refund.status === "processed" || refund.status === "pending") {
      totalRefunded += BigInt(refund.amount);
    }
  }

  const maxAmount = totalAmount - totalRefunded;

  if (order.status === "refunded") {
    return { allowed: false, reason: "Order is already fully refunded.", maxAmount: "0" };
  }

  if (order.status === "disputed") {
    return { allowed: false, reason: "Order is currently under dispute.", maxAmount: "0" };
  }

  if (maxAmount <= 0n) {
    return { allowed: false, reason: "No remaining funds available to refund.", maxAmount: "0" };
  }

  return { allowed: true, reason: "", maxAmount: maxAmount.toString() };
}

/**
 * Calculates a standard refund amount either based on specific line items or the full order.
 */
export function calculateRefundAmount(
  order: EcommerceOrder, 
  lineItemsToRefund?: { itemIndex: number, quantity: number }[]
): { amount: string; type: "full" | "partial" } {
  if (!lineItemsToRefund || lineItemsToRefund.length === 0) {
    // Check eligible maximum if attempting a full refund over partials
    const { maxAmount } = canRefund(order);
    return { amount: maxAmount, type: "full" };
  }

  let partialAmount = 0n;
  
  for (const req of lineItemsToRefund) {
    const item = order.items[req.itemIndex];
    if (!item) continue;
    
    const refundQty = BigInt(req.quantity);
    const unitPrice = BigInt(item.unitPrice);
    
    // Simplistic handling: assuming taxAmount was total per line item, re-calc proportion
    const itemTotalQty = BigInt(item.quantity);
    const itemTotalTax = BigInt(item.taxAmount);
    
    const proportionalTax = (itemTotalTax * refundQty) / itemTotalQty;
    
    partialAmount += (unitPrice * refundQty) + proportionalTax;
  }

  return {
    amount: partialAmount.toString(),
    type: "partial"
  };
}
