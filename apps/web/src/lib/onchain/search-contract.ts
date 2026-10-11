import { z } from "zod";
import { networkIdSchema } from "./network-contract";
export const searchResultSchema = z.object({
  chain: networkIdSchema, query: z.string(), kind: z.enum(["address", "tx"]), checkedAt: z.string().datetime(),
  found: z.boolean(), fields: z.array(z.object({ label: z.string(), value: z.string() })),
});
export type NetworkSearchResult = z.infer<typeof searchResultSchema>;
