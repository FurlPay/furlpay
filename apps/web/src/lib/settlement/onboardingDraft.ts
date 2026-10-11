import { z } from "zod";
import { ASSETS, NETWORKS } from "./model";
import { settlementSchema } from "./onboarding";

// Drafts permit blank form fields, but never arbitrary JSON, oversized arrays,
// invalid nested types, or server-owned fields. Completed data uses full schemas.
const str = (max: number) => z.string().max(max);
const address = z.object({ line1: str(160), line2: str(160), city: str(80), region: str(80), postalCode: str(20) }).partial().strict();
export const DRAFT_SCHEMAS = {
  business: z.object({ type: z.enum(["company", "individual", "marketplace", "nonprofit"]), legalName: str(160), tradingName: str(160), country: str(2), registrationNumber: str(60), industry: str(80), website: str(200), address }).partial().strict(),
  identity: z.object({ verification: z.enum(["kyb", "kyc"]), representative: z.object({ fullName: str(160), dateOfBirth: str(10), email: str(200), phoneCountry: str(2), phone: str(20), idType: z.enum(["PASSPORT", "NATIONAL_ID", "DRIVERS_LICENSE"]), idNumberLast4: str(4) }).partial().strict() }).partial().strict(),
  details: z.object({ incorporationDate: str(10), description: str(500), employees: str(30), revenue: str(30), owners: z.array(z.object({ id: z.string().uuid(), name: str(160), type: z.enum(["individual", "corporate"]), percent: z.number().finite().min(0).max(100), role: str(80) }).strict()).max(20) }).partial().strict(),
  treasury: z.object({ networks: z.array(z.enum(NETWORKS)).max(NETWORKS.length), assets: z.array(z.enum(ASSETS)).max(ASSETS.length), destination: z.enum(["treasury", "virtual_account", "split"]) }).partial().strict(),
  // Remove only cross-field completion rules; shape and field bounds still apply.
  settlement: settlementSchema.innerType().partial().strict(),
} as const;
