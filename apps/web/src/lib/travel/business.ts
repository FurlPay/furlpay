// FurlPay Business Travel — in-memory demo store for team wallets, spending
// policies and expense reporting. A live build persists per-org in the DB.

export interface SpendingPolicy {
  perTripBudgetUsd: number;
  maxHotelStars: number;
  maxFlightCabin: "Economy" | "Premium" | "Business" | "First";
  approvalThresholdUsd: number; // manager approval required above this
  mccLocks: string[];
}

export interface TeamMember {
  email: string;
  role: "admin" | "traveler";
}

export interface BusinessTeam {
  id: string;
  name: string;
  walletUsdc: number;
  members: TeamMember[];
  policy: SpendingPolicy;
  createdAt: string;
}

export const DEFAULT_POLICY: SpendingPolicy = {
  perTripBudgetUsd: 2500,
  maxHotelStars: 4,
  maxFlightCabin: "Premium",
  approvalThresholdUsd: 1000,
  mccLocks: ["7011", "4511"], // lodging + airlines
};

// Shared across route bundles in the same process (see store.ts note).
const teams: Map<string, BusinessTeam> = ((globalThis as any).__furlpayBizTeams ??= new Map<string, BusinessTeam>());

function seed() {
  if (teams.size) return;
  teams.set("team_demo", {
    id: "team_demo",
    name: "Acme Labs",
    walletUsdc: 18_500,
    members: [
      { email: "ceo@acme.dev", role: "admin" },
      { email: "eng@acme.dev", role: "traveler" },
      { email: "sales@acme.dev", role: "traveler" },
    ],
    policy: { ...DEFAULT_POLICY },
    createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  });
}

export function createTeam(name: string, walletUsdc = 0, members: TeamMember[] = []): BusinessTeam {
  seed();
  const team: BusinessTeam = {
    id: "team_" + Math.random().toString(36).slice(2, 10),
    name,
    walletUsdc,
    members,
    policy: { ...DEFAULT_POLICY },
    createdAt: new Date().toISOString(),
  };
  teams.set(team.id, team);
  return team;
}

export function getTeam(id?: string): BusinessTeam | undefined {
  seed();
  return teams.get(id ?? "team_demo");
}

export function updatePolicy(teamId: string, patch: Partial<SpendingPolicy>): BusinessTeam | undefined {
  seed();
  const team = teams.get(teamId);
  if (!team) return undefined;
  team.policy = { ...team.policy, ...patch };
  return team;
}
