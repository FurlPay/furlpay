// ---------------------------------------------------------------------------
// Transaction graph — relationship queries over the user's payment history
// (the Aladdin Graph API pattern: portfolios there, payment counterparties
// here). Nodes are the user plus every counterparty; edges aggregate the
// flow between them so clients can answer "who do I pay most?", "where does
// my money come from?" and render a money-flow diagram without re-deriving
// it from the raw transaction list.
// ---------------------------------------------------------------------------

import { db } from "@/lib/store";
import type { Transaction } from "@/lib/types";

export type NodeType = "user" | "merchant" | "person" | "platform";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
}

export interface GraphEdge {
  from: string; // node id
  to: string; // node id
  totalUsd: number;
  count: number;
  categories: string[];
  lastAt: string; // ISO timestamp of the most recent transaction
}

export interface CounterpartyStat {
  label: string;
  type: NodeType;
  direction: "in" | "out";
  totalUsd: number;
  count: number;
}

export interface TransactionGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  topRecipients: CounterpartyStat[];
  topSources: CounterpartyStat[];
  totals: { outUsd: number; inUsd: number; counterparties: number };
}

export const USER_NODE_ID = "user:me";

const round = (n: number) => Math.round(n * 100) / 100;

/** Classify a counterparty from what the ledger records about it. */
function nodeType(t: Transaction): NodeType {
  if (t.category === "transfer" && !/merchant|store|shop/i.test(t.title)) return "person";
  if (t.category === "swap" || t.category === "invest" || t.category === "yield" || t.category === "ramp")
    return "platform";
  return "merchant";
}

const nodeId = (label: string) => `cp:${label.toLowerCase().replace(/\s+/g, "-")}`;

/** Build the aggregated counterparty graph from settled/pending transactions. */
export function buildTransactionGraph(limit = 10): TransactionGraph {
  const txs = db.transactions.filter((t) => t.status !== "declined");

  const nodes = new Map<string, GraphNode>([
    [USER_NODE_ID, { id: USER_NODE_ID, type: "user", label: "You" }],
  ]);
  // Keyed by `${counterpartyId}:${direction}` so inflow and outflow to the
  // same counterparty stay separate edges.
  const edges = new Map<string, GraphEdge & { categorySet: Set<string> }>();

  for (const t of txs) {
    const label = t.title.trim() || "Unknown";
    const id = nodeId(label);
    if (!nodes.has(id)) nodes.set(id, { id, type: nodeType(t), label });

    const [from, to] = t.direction === "out" ? [USER_NODE_ID, id] : [id, USER_NODE_ID];
    const key = `${id}:${t.direction}`;
    const edge =
      edges.get(key) ??
      { from, to, totalUsd: 0, count: 0, categories: [], lastAt: t.timestamp, categorySet: new Set<string>() };
    edge.totalUsd += t.amountUsd;
    edge.count++;
    edge.categorySet.add(t.category);
    if (new Date(t.timestamp) > new Date(edge.lastAt)) edge.lastAt = t.timestamp;
    edges.set(key, edge);
  }

  const edgeList: GraphEdge[] = [...edges.values()].map(({ categorySet, ...e }) => ({
    ...e,
    totalUsd: round(e.totalUsd),
    categories: [...categorySet],
  }));

  const stat = (direction: "in" | "out"): CounterpartyStat[] =>
    edgeList
      .filter((e) => (direction === "out" ? e.from === USER_NODE_ID : e.to === USER_NODE_ID))
      .map((e) => {
        const cp = nodes.get(direction === "out" ? e.to : e.from)!;
        return { label: cp.label, type: cp.type, direction, totalUsd: e.totalUsd, count: e.count };
      })
      .sort((a, b) => b.totalUsd - a.totalUsd)
      .slice(0, limit);

  const outUsd = round(
    edgeList.filter((e) => e.from === USER_NODE_ID).reduce((s, e) => s + e.totalUsd, 0)
  );
  const inUsd = round(
    edgeList.filter((e) => e.to === USER_NODE_ID).reduce((s, e) => s + e.totalUsd, 0)
  );

  return {
    nodes: [...nodes.values()],
    edges: edgeList,
    topRecipients: stat("out"),
    topSources: stat("in"),
    totals: { outUsd, inUsd, counterparties: nodes.size - 1 },
  };
}
