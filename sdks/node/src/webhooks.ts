import crypto from "crypto";
import { FurlpayEvent } from "./types";

const TOLERANCE_SECONDS = 300;

/**
 * Verify a Furlpay webhook signature and return the typed event.
 * Mirrors Stripe's `webhooks.constructEvent`.
 *
 * @example
 *   const event = Furlpay.webhooks.constructEvent(
 *     req.body, req.headers['furlpay-signature'], process.env.FURLPAY_ENDPOINT_SECRET
 *   );
 */
export const webhooks = {
  constructEvent<T = unknown>(
    payload: string | Buffer,
    signatureHeader: string | string[] | undefined,
    secret: string
  ): FurlpayEvent<T> {
    const body = typeof payload === "string" ? payload : payload.toString("utf8");
    const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!header) throw new Error("Missing furlpay-signature header");

    const parts = Object.fromEntries(
      header.split(",").map((kv) => kv.split("=").map((s) => s.trim()))
    ) as { t?: string; v1?: string };
    if (!parts.t || !parts.v1) throw new Error("Malformed furlpay-signature header");

    const t = Number(parts.t);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - t) > TOLERANCE_SECONDS) {
      throw new Error("Signature timestamp outside tolerance (possible replay)");
    }

    const expected = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(parts.v1);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error("Signature verification failed");
    }

    return JSON.parse(body) as FurlpayEvent<T>;
  },

  /** Produce a signature header (used by the CLI / tests to emit signed events). */
  sign(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const v1 = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    return `t=${timestamp},v1=${v1}`;
  },
};
