import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET  /api/agents         — Agent Console state (agents, policies, activity)
// POST /api/agents         — { id, action: "pause" | "resume" | "revoke" | "approve" | "deny", txId? }
//
// "Corporate cards for AI agents" — per-agent budgets, merchant allowlists, and
// human-in-the-loop approvals. Mock/demo, in-memory. A live build binds each
// agent to a scoped `ak_` key and enforces policies at the x402 facilitator.

type Status = "active" | "paused" | "revoked";
interface Agent {
  id: string;
  name: string;
  model: string;
  status: Status;
  dailyBudget: number;
  spentToday: number;
  merchants: string[];
  lastTxAgo: string;
  keyPrefix: string;
}
interface Policy {
  id: string;
  name: string;
  maxPerTx: number;
  daily: number;
  allow: string[];
  block: string[];
  autoApproveUnder: number;
}
interface Activity {
  id: string;
  time: string;
  agent: string;
  merchant: string;
  amount: number;
  state: "settled" | "pending";
}

function seed() {
  const agents: Agent[] = [
    { id: "ag_claude_shop", name: "Claude-Shopping", model: "claude", status: "active", dailyBudget: 50, spentToday: 12.3, merchants: ["Amazon", "Uber", "DoorDash"], lastTxAgo: "2m ago", keyPrefix: "ak_live_9f21…" },
    { id: "ag_gpt_research", name: "GPT-Research", model: "gpt", status: "active", dailyBudget: 5, spentToday: 0.82, merchants: ["APIs only (x402)"], lastTxAgo: "15m ago", keyPrefix: "ak_live_3a7c…" },
    { id: "ag_cursor_devops", name: "Cursor-DevOps", model: "cursor", status: "paused", dailyBudget: 20, spentToday: 0, merchants: ["GitHub", "Vercel", "AWS"], lastTxAgo: "2h ago", keyPrefix: "ak_live_b0d4…" },
  ];
  const policies: Policy[] = [
    { id: "pol_shop", name: "Shopping Agent", maxPerTx: 25, daily: 50, allow: ["Retail", "Food"], block: ["Gambling", "Adult", "Crypto swaps"], autoApproveUnder: 10 },
    { id: "pol_api", name: "API Buyer", maxPerTx: 1, daily: 5, allow: ["Developer APIs"], block: ["Everything else"], autoApproveUnder: 1 },
  ];
  const activity: Activity[] = [
    { id: "tx1", time: "12:45", agent: "Claude-Shopping", merchant: "Amazon", amount: 8.99, state: "settled" },
    { id: "tx2", time: "12:32", agent: "GPT-Research", merchant: "Apify", amount: 0.02, state: "settled" },
    { id: "tx3", time: "12:15", agent: "Claude-Shopping", merchant: "Uber", amount: 3.31, state: "settled" },
    { id: "tx4", time: "11:58", agent: "Claude-Shopping", merchant: "BestBuy", amount: 127, state: "pending" },
  ];
  return { agents, policies, activity };
}

const g = globalThis as unknown as { __agents?: ReturnType<typeof seed> };
function state() {
  return (g.__agents ??= seed());
}

export function GET() {
  const s = state();
  const totalSpent = s.agents.reduce((a, x) => a + x.spentToday, 0);
  const pending = s.activity.filter((a) => a.state === "pending").length;
  return NextResponse.json({
    ...s,
    summary: {
      activeAgents: s.agents.filter((a) => a.status === "active").length,
      totalSpentToday: Math.round(totalSpent * 100) / 100,
      pendingApprovals: pending,
    },
  });
}

export async function POST(req: NextRequest) {
  const s = state();
  const body = await req.json().catch(() => ({}));
  const { id, action, txId } = body as { id?: string; action?: string; txId?: string };

  if (action === "approve" || action === "deny") {
    const tx = s.activity.find((a) => a.id === txId);
    if (!tx) return NextResponse.json({ ok: false, error: "unknown_tx" }, { status: 400 });
    if (action === "approve") tx.state = "settled";
    else s.activity = s.activity.filter((a) => a.id !== txId);
    return NextResponse.json({ ok: true });
  }

  const agent = s.agents.find((a) => a.id === id);
  if (!agent) return NextResponse.json({ ok: false, error: "unknown_agent" }, { status: 400 });
  if (action === "pause") agent.status = "paused";
  else if (action === "resume") agent.status = "active";
  else if (action === "revoke") agent.status = "revoked";
  else return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });

  return NextResponse.json({ ok: true, status: agent.status });
}
