// ---------------------------------------------------------------------------
// Disaster recovery configuration and health checks.
//
// THE GAP: The audit identified zero backup policies, no defined RTO/RPO
// targets, and no failover documentation. A payment system that cannot
// recover from a database failure within hours will lose customer funds
// and regulatory standing.
//
// THIS MODULE: defines the recovery targets, backup schedules, and
// health checks that an ops team needs to implement and monitor.
// ---------------------------------------------------------------------------

export interface RecoveryTarget {
  /** Recovery Time Objective: max acceptable downtime */
  rtoMinutes: number;
  /** Recovery Point Objective: max acceptable data loss */
  rpoMinutes: number;
  /** Tier classification */
  tier: "critical" | "standard" | "low";
  /** What this target applies to */
  component: string;
}

export interface BackupPolicy {
  component: string;
  schedule: string;     // cron expression
  retentionDays: number;
  type: "full" | "incremental" | "wal_archive";
  encrypted: boolean;
  verified: boolean;    // Whether restore has been tested
  lastVerifiedAt?: string;
}

export interface FailoverConfig {
  component: string;
  primaryRegion: string;
  failoverRegion: string;
  autoFailover: boolean;
  healthCheckIntervalMs: number;
  failoverThreshold: number; // consecutive failures before failover
}

export const RECOVERY_TARGETS: Record<string, RecoveryTarget> = {
  database: {
    component: "Database (Postgres/Supabase)",
    rtoMinutes: 15,
    rpoMinutes: 1,
    tier: "critical",
  },
  redis: {
    component: "Redis (rate limit/velocity)",
    rtoMinutes: 5,
    rpoMinutes: 0,
    tier: "standard",
  },
  hotWallet: {
    component: "Hot wallet keys (MPC)",
    rtoMinutes: 60,
    rpoMinutes: 0,
    tier: "critical",
  },
  rpcProviders: {
    component: "RPC providers",
    rtoMinutes: 0,
    rpoMinutes: 0,
    tier: "critical",
  },
  applicationServers: {
    component: "Application servers",
    rtoMinutes: 2,
    rpoMinutes: 0,
    tier: "standard",
  },
};

export const BACKUP_POLICIES: BackupPolicy[] = [
  {
    component: "Database (Postgres/Supabase)",
    schedule: "* * * * *", // WAL archiving every minute
    retentionDays: 30,
    type: "wal_archive",
    encrypted: true,
    verified: false,
  },
  {
    component: "Database (Postgres/Supabase)",
    schedule: "0 0 * * *", // Full backup daily
    retentionDays: 90,
    type: "full",
    encrypted: true,
    verified: false,
  },
  {
    component: "Hot wallet keys (MPC)",
    schedule: "0 0 1 * *", // Monthly key ceremony backup
    retentionDays: 365,
    type: "full",
    encrypted: true,
    verified: false,
  },
];

export const FAILOVER_CONFIGS: FailoverConfig[] = [
  {
    component: "Database (Postgres/Supabase)",
    primaryRegion: "us-east-1",
    failoverRegion: "us-west-2",
    autoFailover: true,
    healthCheckIntervalMs: 5000,
    failoverThreshold: 3,
  },
  {
    component: "RPC providers",
    primaryRegion: "global",
    failoverRegion: "fallback-pool",
    autoFailover: true,
    healthCheckIntervalMs: 2000,
    failoverThreshold: 2,
  },
  {
    component: "Application servers",
    primaryRegion: "iad1",
    failoverRegion: "sfo1",
    autoFailover: true,
    healthCheckIntervalMs: 10000,
    failoverThreshold: 3,
  },
];

export function checkRecoveryReadiness(): { ready: boolean; gaps: string[] } {
  const gaps: string[] = [];

  for (const policy of BACKUP_POLICIES) {
    if (!policy.verified) {
      gaps.push(`Backup policy for ${policy.component} has not been verified.`);
    }
  }

  for (const config of FAILOVER_CONFIGS) {
    if (!config.autoFailover && RECOVERY_TARGETS[config.component]?.rtoMinutes === 0) {
      gaps.push(`Component ${config.component} has RTO 0 but no auto-failover configured.`);
    }
  }

  return { ready: gaps.length === 0, gaps };
}

export function estimateDataLossWindow(lastBackupAt: string, rpo: number): { withinRpo: boolean; actualMinutes: number } {
  const lastBackup = new Date(lastBackupAt).getTime();
  const now = Date.now();
  const diffMinutes = Math.floor((now - lastBackup) / 60000);

  return {
    withinRpo: diffMinutes <= rpo,
    actualMinutes: diffMinutes,
  };
}
