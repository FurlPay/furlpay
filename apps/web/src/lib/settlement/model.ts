import { z } from "zod";

export const NETWORKS = [
  "arbitrum",
  "base",
  "ethereum",
  "solana",
  "polygon",
] as const;
export const ASSETS = ["USDC", "EURC", "USDT", "USD", "EUR", "GBP"] as const;
export type Network = (typeof NETWORKS)[number];
export type Asset = (typeof ASSETS)[number];

// Drafts never confer authority to spend, screen a payee, or activate a rule.
// Keep amounts as decimal strings, calculate in minor units, and bound totals.
const positiveMoney = z.coerce.number().finite().positive().max(1_000_000);
export const moneySchema = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,6})(\.\d{1,2})?$/,
    "Use an amount with at most two decimal places"
  )
  .refine(
    (value) => positiveMoney.safeParse(value).success,
    "Amount must be between 0.01 and 1,000,000"
  );
const name = z.string().trim().min(1).max(120);
const note = z.string().trim().max(500);
const network = z.enum(NETWORKS);
const asset = z.enum(ASSETS);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const parsed = new Date(v);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === v
    );
  }, "Choose a valid date");
export const invoiceLineSchema = z
  .object({
    description: name,
    quantity: z.number().int().positive().max(10_000),
    unitPrice: moneySchema,
    taxBps: z.number().int().min(0).max(10_000),
  })
  .strict();
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

export function minorUnits(value: string): number {
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value))
    throw new Error("Invalid decimal amount");
  const [whole, decimal = ""] = value.split(".");
  return Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
}
export function decimalAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error("Invalid minor units");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
export function invoiceTotals(lines: InvoiceLine[], discountBps = 0) {
  if (!Number.isInteger(discountBps) || discountBps < 0 || discountBps > 9_999)
    throw new Error("Invalid discount");
  let subtotal = 0,
    discount = 0,
    tax = 0;
  for (const line of lines) {
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 10_000 ||
      !Number.isInteger(line.taxBps) ||
      line.taxBps < 0 ||
      line.taxBps > 10_000
    )
      throw new Error("Invalid line item");
    const gross = minorUnits(line.unitPrice) * line.quantity;
    const deduction = Math.floor((gross * discountBps + 5_000) / 10_000);
    subtotal += gross;
    discount += deduction;
    tax += Math.floor(((gross - deduction) * line.taxBps + 5_000) / 10_000);
  }
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

const wallet = z
  .object({
    kind: z.literal("beneficiary"),
    name,
    network,
    address: z.string().trim().min(32).max(44),
    note,
  })
  .strict();
const payout = z
  .object({
    kind: z.literal("payout"),
    name,
    network,
    asset: z.literal("USDC"),
    address: z.string().trim().min(32).max(44),
    amount: moneySchema,
    note,
  })
  .strict();
const schedule = z
  .object({
    kind: z.literal("schedule"),
    name,
    network,
    address: z.string().trim().min(32).max(44),
    amount: moneySchema,
    startDate: date,
    frequency: z.enum(["once", "weekly", "monthly"]),
    note,
  })
  .strict();
const invoice = z
  .object({
    kind: z.literal("invoice"),
    name,
    customer: name,
    asset,
    dueDate: date,
    lines: z.array(invoiceLineSchema).min(1).max(50),
    discountBps: z.number().int().min(0).max(9_999),
    note,
  })
  .strict();
const link = z
  .object({
    kind: z.literal("link"),
    name,
    amount: moneySchema.optional(),
    mode: z.enum(["fixed", "open"]),
    asset,
    network,
    expiresOn: date,
    note,
  })
  .strict();
const rule = z
  .object({
    kind: z.literal("rule"),
    name,
    network,
    allocations: z
      .array(
        z
          .object({
            label: name,
            percentage: z.number().int().positive().max(100),
          })
          .strict()
      )
      .min(2)
      .max(10),
  })
  .strict();
const checkout = z
  .object({
    kind: z.literal("checkout"),
    name,
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    returnUrl: z
      .string()
      .url()
      .max(2048)
      .refine((v) => v.startsWith("https://"), "Use an HTTPS return URL"),
    networks: z.array(network).min(1).max(5),
  })
  .strict();

export const draftSchema = z
  .discriminatedUnion("kind", [
    wallet,
    payout,
    schedule,
    invoice,
    link,
    rule,
    checkout,
  ])
  .superRefine((draft, ctx) => {
    if (draft.kind === "invoice") {
      try {
        const total = invoiceTotals(draft.lines, draft.discountBps).total;
        if (total <= 0 || total > 100_000_000)
          ctx.addIssue({
            code: "custom",
            path: ["lines"],
            message: "Invoice total must be between 0.01 and 1,000,000",
          });
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["lines"],
          message: "Invalid invoice amounts",
        });
      }
    }
    if (draft.kind === "link" && draft.mode === "fixed" && !draft.amount)
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "A fixed payment link needs an amount",
      });
    if (draft.kind === "link" && draft.mode === "open" && draft.amount)
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "An open payment link cannot have a fixed amount",
      });
    if (
      draft.kind === "rule" &&
      draft.allocations.reduce((sum, row) => sum + row.percentage, 0) !== 100
    )
      ctx.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "Allocations must add up to 100%",
      });
    if (
      "address" in draft &&
      draft.network !== "solana" &&
      !/^0x[0-9a-fA-F]{40}$/.test(draft.address)
    )
      ctx.addIssue({
        code: "custom",
        path: ["address"],
        message: "Enter a valid EVM wallet address",
      });
  });
export type Draft = z.infer<typeof draftSchema>;
export type DraftKind = Draft["kind"];
export type WorkspaceRecord = {
  id: string;
  createdAt: string;
  archivedAt: string | null;
  data: Draft;
};
export const createRecordSchema = z
  .object({ id: z.string().uuid(), data: draftSchema })
  .strict();
export const archiveRecordSchema = z.object({ id: z.string().uuid() }).strict();

export type Activity = {
  id: string;
  name: string;
  /** Ledger subtitle (e.g. counterparty detail or memo), when recorded. */
  detail?: string;
  type: string;
  direction: "in" | "out";
  amountUsd: number;
  asset: string;
  network: string;
  status: string;
  timestamp: string;
};
export type WorkspaceSnapshot = {
  name: string;
  verification: string;
  /** Deployment the data came from: production, preview or development. */
  environment: "production" | "preview" | "development";
  balances: {
    asset: string;
    network: string;
    amount: number;
    /** USD value as recorded on the account ledger. */
    usd: number;
    custody: "ledger" | "fiat";
  }[];
  transactions: Activity[];
  /** Computed server-side from the same balances and transactions above. */
  overview: {
    treasury: ReturnType<typeof import("./overview").treasury>;
    inTransit: ReturnType<typeof import("./overview").inTransit>;
    activity: Record<import("./overview").Range, ReturnType<typeof import("./overview").activity>>;
  };
  records: WorkspaceRecord[];
  storage: "available" | "unavailable";
  storageMessage?: string;
  asOf: string;
};

export function approvalTier(amount: number) {
  if (amount <= 1_000)
    return {
      label: "Tier 1",
      requirement: "Verified recipient and policy checks",
      signatures: 0,
      delayMinutes: 0,
    };
  if (amount <= 10_000)
    return {
      label: "Tier 2",
      requirement: "One finance approval",
      signatures: 1,
      delayMinutes: 0,
    };
  if (amount <= 100_000)
    return {
      label: "Tier 3",
      requirement: "Two distinct finance approvers",
      signatures: 2,
      delayMinutes: 0,
    };
  return {
    label: "Tier 4",
    requirement: "Two executive approvers · 60-minute hold",
    signatures: 2,
    delayMinutes: 60,
  };
}

export type BatchLine = {
  row: number;
  name: string;
  address: string;
  amount: string;
  network: Network;
  reference: string;
  error?: string;
};
/** RFC 4180 reader, including quoted commas, CRLF and escaped quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false,
    closed = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else value += char;
    } else if (char === '"' && !value && !closed) quoted = true;
    else if (char === ",") {
      row.push(value);
      value = "";
      closed = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(value);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      value = "";
      closed = false;
    } else {
      if (closed || char === '"') throw new Error("Malformed CSV quoting");
      value += char;
    }
  }
  if (quoted) throw new Error("Unclosed quote in CSV");
  row.push(value);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

export async function validateDestination(
  address: string,
  chain: Network
): Promise<boolean> {
  if (chain !== "solana") return /^0x[0-9a-fA-F]{40}$/.test(address);
  try {
    const { PublicKey } = await import("@solana/web3.js");
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export async function validateBatch(text: string): Promise<BatchLine[]> {
  if (new TextEncoder().encode(text).length > 100_000)
    throw new Error("CSV must be smaller than 100 KB");
  const [header, ...rows] = parseCsv(text);
  const fields = ["name", "address", "amount", "network", "reference"];
  if (
    !header ||
    fields.some((field, i) => header[i]?.trim().toLowerCase() !== field) ||
    header.length !== 5
  )
    throw new Error(`Expected columns: ${fields.join(",")}`);
  if (!rows.length || rows.length > 100)
    throw new Error("Upload between 1 and 100 recipients");
  return Promise.all(
    rows.map(async (row, i) => {
      const [
        recipient = "",
        address = "",
        amount = "",
        rawNetwork = "",
        reference = "",
      ] = row.map((cell) => cell.trim());
      const chain = rawNetwork.toLowerCase() as Network;
      const errors: string[] = [];
      if (row.length !== 5) errors.push("Expected 5 columns");
      if (!recipient || recipient.length > 120)
        errors.push("Invalid recipient name");
      if (reference.length > 128) errors.push("Reference is too long");
      if (!NETWORKS.includes(chain)) errors.push("Unsupported network");
      else if (!(await validateDestination(address, chain)))
        errors.push("Invalid wallet address");
      if (!moneySchema.safeParse(amount).success)
        errors.push("Invalid amount (0.01–1,000,000; max 2 decimals)");
      return {
        row: i + 2,
        name: recipient,
        address,
        amount,
        network: chain,
        reference,
        ...(errors.length ? { error: errors.join("; ") } : {}),
      };
    })
  );
}

export function recordAmount(data: Draft): string {
  if (data.kind === "invoice")
    return decimalAmount(invoiceTotals(data.lines, data.discountBps).total);
  if ("amount" in data && data.amount) return data.amount;
  return "";
}
