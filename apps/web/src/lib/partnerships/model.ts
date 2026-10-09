import { z } from "zod";

// Partnership inquiries: the one schema both the modal and POST
// /api/partnerships/inquiries validate against, so a value the browser accepts
// is a value the server accepts (and the server re-checks everything).
//
// The categories are AREAS a partner may want to discuss. They are not claims
// that a product exists in that area; the page states product status separately.

export const PARTNERSHIP_INTERESTS = [
  { id: "stablecoin-infrastructure", title: "Stablecoin & blockchain infrastructure", description: "Networks, issuers and node providers for USDC settlement across chains." },
  { id: "banking-infrastructure", title: "Banking & payment infrastructure", description: "Licensed banking, virtual accounts and local payment rails." },
  { id: "card-issuing", title: "Card issuing & processing", description: "Issuing programs, processors and network membership." },
  { id: "wallet-custody", title: "Wallet & custody infrastructure", description: "Key management, MPC, smart accounts and qualified custody." },
  { id: "travel-commerce", title: "Travel & commerce", description: "Hotels, flights and merchants accepting stablecoin payments." },
  { id: "ai-agent-payments", title: "AI agents & programmable payments", description: "Agent authorization, spend policies and pay-per-call (x402)." },
  { id: "merchant-integrations", title: "Merchant payment integrations", description: "Checkout plugins, platforms and payment links." },
  { id: "cross-border-settlement", title: "Cross-border settlement", description: "Corridors, FX and on/off-ramps between stablecoins and local currency." },
  { id: "developer-api", title: "Developer & API integrations", description: "SDKs, platforms and tools building on FurlPay APIs." },
  { id: "security-compliance", title: "Security, compliance & risk", description: "KYC/KYB, screening, Travel Rule and audit partners." },
  { id: "ecosystem-technology", title: "Ecosystem & technology", description: "Protocols, accelerators and technology collaborations." },
  { id: "strategic-business", title: "Strategic business partnerships", description: "Distribution, joint products and market entry." },
] as const;
export type PartnershipInterest = (typeof PARTNERSHIP_INTERESTS)[number]["id"];
export const INTEREST_IDS = PARTNERSHIP_INTERESTS.map(i => i.id) as [PartnershipInterest, ...PartnershipInterest[]];

export const CONTACT_METHODS = [
  { id: "telegram", label: "Telegram", placeholder: "Enter Telegram username" },
  { id: "whatsapp", label: "WhatsApp", placeholder: "Phone number with country code, e.g. +65 8123 4567" },
  { id: "email", label: "Email", placeholder: "Leave blank to use your work email" },
  { id: "linkedin", label: "LinkedIn", placeholder: "https://www.linkedin.com/in/your-profile" },
  { id: "discord", label: "Discord", placeholder: "Enter Discord username" },
  { id: "other", label: "Other", placeholder: "How should we reach you?" },
] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number]["id"];
export const CONTACT_IDS = CONTACT_METHODS.map(m => m.id) as [ContactMethod, ...ContactMethod[]];

export const INQUIRY_STATUSES = ["new", "reviewing", "contacted", "qualified", "in_discussion", "accepted", "declined", "closed"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const SOURCES = ["partners_hero", "partners_card", "partners_cta", "nav", "direct"] as const;

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Normalise and validate a contact detail for its method. Returns the stored
 * form, or an error message written for the person filling in the form.
 */
export function normalizeContact(method: ContactMethod, raw: string, workEmail: string): { value: string } | { error: string } {
  const v = raw.trim();
  switch (method) {
    case "telegram": {
      const h = v.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "");
      return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(h) ? { value: `@${h}` } : { error: "Enter a Telegram username (5–32 letters, digits or underscores)." };
    }
    case "whatsapp": {
      const n = v.replace(/[\s().-]/g, "");
      return /^\+[1-9]\d{7,14}$/.test(n) ? { value: n } : { error: "Enter the number with its country code, e.g. +65 8123 4567." };
    }
    case "email": {
      const e = (v || workEmail).toLowerCase();
      return EMAIL.test(e) && e.length <= 254 ? { value: e } : { error: "Enter a valid email address." };
    }
    case "linkedin": {
      let u: URL;
      try { u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); } catch { return { error: "Enter your LinkedIn profile URL." }; }
      const host = u.hostname.toLowerCase();
      if ((host !== "linkedin.com" && !host.endsWith(".linkedin.com")) || !/^\/(in|company)\/[^/]+/.test(u.pathname)) return { error: "Enter a linkedin.com/in/… or linkedin.com/company/… URL." };
      return { value: `https://www.linkedin.com${u.pathname.replace(/\/+$/, "")}` };
    }
    case "discord": {
      const d = v.toLowerCase();
      return /^(?!.*\.\.)[a-z0-9_.]{2,32}$/.test(d) ? { value: d } : { error: "Enter a Discord username (2–32 lowercase letters, digits, _ or .)." };
    }
    case "other":
      return v.length >= 2 && v.length <= 200 ? { value: v } : { error: "Tell us how to reach you (2–200 characters)." };
  }
}

/** A website as typed ("acme.com") → https URL, or an error. Only http(s). */
export function normalizeWebsite(raw: string): { value: string | null } | { error: string } {
  const v = raw.trim();
  if (!v) return { value: null };
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || u.username || u.password || u.toString().length > 300 || /[\u0000-\u0020]/.test(v)) throw new Error();
    return { value: u.toString() };
  } catch {
    return { error: "Enter a website address, e.g. https://yourcompany.com." };
  }
}

const text = (max: number) => z.string().trim().max(max).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/, "Remove unsupported control characters.");

export const inquiryInputSchema = z.object({
  company: text(120).min(2, "Enter your company or project name."),
  workEmail: text(254).toLowerCase().regex(EMAIL, "Enter a valid work email."),
  contactMethod: z.enum(CONTACT_IDS),
  contactDetail: text(300),
  fullName: text(120).optional().default(""),
  jobTitle: text(120).optional().default(""),
  website: text(300).optional().default(""),
  interest: z.enum(INTEREST_IDS, { errorMap: () => ({ message: "Choose a partnership type." }) }),
  message: text(4000).optional().default(""),
  source: z.enum(SOURCES).optional().default("direct"),
  // Bot traps: a field humans never see, and how long the form was open.
  companySite: z.string().max(0, "Submission rejected.").optional().default(""),
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
}).strict();
export type InquiryInput = z.input<typeof inquiryInputSchema>;

export type NormalizedInquiry = {
  company_name: string; work_email: string; contact_method: ContactMethod; contact_detail: string;
  full_name: string | null; job_title: string | null; website: string | null;
  partnership_interest: PartnershipInterest; additional_information: string | null; source_page: string;
};

/** Field → message for everything wrong with a submission; empty when valid. */
export function validateInquiry(input: unknown): { ok: true; row: NormalizedInquiry } | { ok: false; errors: Record<string, string> } {
  const parsed = inquiryInputSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) { const k = String(i.path[0] ?? "form"); errors[k] ??= i.message; }
    return { ok: false, errors };
  }
  const d = parsed.data;
  const errors: Record<string, string> = {};
  const contact = normalizeContact(d.contactMethod, d.contactDetail, d.workEmail);
  if ("error" in contact) errors.contactDetail = contact.error;
  const site = normalizeWebsite(d.website);
  if ("error" in site) errors.website = site.error;
  if (Object.keys(errors).length || "error" in contact || "error" in site) return { ok: false, errors };
  return {
    ok: true,
    row: {
      company_name: d.company, work_email: d.workEmail, contact_method: d.contactMethod, contact_detail: contact.value,
      full_name: d.fullName || null, job_title: d.jobTitle || null, website: site.value,
      partnership_interest: d.interest, additional_information: d.message || null, source_page: d.source,
    },
  };
}
