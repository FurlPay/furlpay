import { z } from "zod";

// Shared Zod shapes for the card lifecycle routes. Kept in one place so the
// order, reissue and shipping-change routes cannot drift apart on what a valid
// address is — a card is physically posted against this.
export const ShippingAddressSchema = z.object({
  name: z.string().trim().min(1).max(80),
  line1: z.string().trim().min(1).max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(1).max(80),
  postcode: z.string().trim().min(2).max(16),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .length(2)
    .regex(/^[A-Z]{2}$/, "Country must be an ISO-3166 alpha-2 code"),
});

export const CardLabelSchema = z.string().trim().min(1).max(24);

/** Digits only, and never coerced from a number — "0042" must survive. */
export const PinSchema = z.string().regex(/^\d{4}$/, "PIN must be 4 digits");
