import { z } from "zod";

export const networkIdSchema = z.enum(["ethereum", "base", "arbitrum", "polygon", "solana"]);
const integer = z.string().regex(/^\d+$/);
export const networkTransferSchema = z.object({
  key: z.string(), chain: networkIdSchema, hash: z.string(), blockHash: z.string(), block: integer,
  from: z.string(), to: z.string(), amountRaw: integer, kind: z.enum(["transfer", "mint", "burn"]), finalized: z.boolean(),
});
export const networkSnapshotSchema = z.object({
  generatedAt: z.string().datetime(),
  chains: z.array(z.object({
    chain: networkIdSchema, state: z.enum(["ready", "degraded", "unavailable"]), source: z.enum(["configured_rpc", "public_rpc"]),
    checkedAt: z.string().datetime(), reason: z.string().nullable(), head: integer.nullable(), finalized: integer.nullable(),
    supplyRaw: integer.nullable(), supplyBlock: integer.nullable(), rpcMs: z.number().nonnegative().nullable(),
    activity: z.object({ fromBlock: integer, toBlock: integer, transfers: z.number().int().nonnegative(), volumeRaw: integer, mintedRaw: integer, burnedRaw: integer, senders: z.number().int().nonnegative(), receivers: z.number().int().nonnegative(), events: z.array(networkTransferSchema) }).nullable(),
  })),
});
export type NetworkSnapshot = z.infer<typeof networkSnapshotSchema>;
export type NetworkStatus = NetworkSnapshot["chains"][number];
export type NetworkTransfer = z.infer<typeof networkTransferSchema>;
