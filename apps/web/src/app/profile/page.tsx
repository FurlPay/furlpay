"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getJSON, sendJSON } from "@/lib/api";
import { clearOfflineData } from "@/lib/offline";
import { PageHeader, Pill, Spinner, timeAgo } from "@/components/ui";

interface Device { name: string; location: string; lastActive: string; current: boolean }
interface Profile {
  name: string;
  email: string;
  safeAddress: string;
  kycStatus: "verified" | "pending" | "unverified";
  region: string;
  tier: "Standard" | "Pro" | "Ultra";
  security: {
    biometricEnabled: boolean;
    accountLocked: boolean;
    lastLogin: string;
    loginAlerts: boolean;
    totpEnabled: boolean;
    hardwareKeys: { name: string; addedAt: string }[];
    devices: Device[];
  };
  notifications: { transactions: boolean; security: boolean; priceAlerts: boolean; product: boolean };
}

export default function ProfilePage() {
  const router = useRouter();
  const [p, setP] = useState<Profile | null>(null);

  const load = useCallback(() => {
    getJSON<Profile>("/api/profile").then(setP).catch(console.error);
  }, []);
  useEffect(() => load(), [load]);

  async function patch(body: Record<string, unknown>) {
    await sendJSON("/api/profile", body, "PATCH");
    load();
  }

  async function logout() {
    // Wipe offline account data (IndexedDB + cached page HTML) with the session.
    await clearOfflineData();
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (!p) return <Spinner />;

  const kycTone: "gain" | "accent" | "loss" =
    p.kycStatus === "verified" ? "gain" : p.kycStatus === "pending" ? "accent" : "loss";

  return (
    <>
      <PageHeader title="Profile" right={<Pill tone="accent">{p.tier}</Pill>} />

      {/* Identity header */}
      <section className="px-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-2xl font-bold">
            {p.name.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xl font-bold">{p.name}</p>
            <p className="truncate text-[13px] text-textSecondary">{p.email}</p>
            <p className="mt-0.5 font-mono text-[11px] text-textMuted">{p.safeAddress} · {p.region}</p>
          </div>
        </div>
      </section>

      {/* KYC / verification */}
      <Group title="Identity">
        <Row label="KYC status" right={<Pill tone={kycTone}>{p.kycStatus}</Pill>} />
        {p.kycStatus !== "verified" && (
          <button onClick={() => router.push("/signup")} className="w-full px-4 py-3 text-left text-[14px] text-accent">
            Verify your account →
          </button>
        )}
        <Row label="Plan tier" right={<Pill tone="accent">{p.tier}</Pill>} />
      </Group>

      {/* Security center */}
      <Group title="Security center">
        <Toggle label="Biometric unlock (Face ID)" on={p.security.biometricEnabled}
          onClick={() => patch({ security: { biometricEnabled: !p.security.biometricEnabled } })} />
        <Toggle label="Login & activity alerts" on={p.security.loginAlerts}
          onClick={() => patch({ security: { loginAlerts: !p.security.loginAlerts } })} />
        <Row label="Authenticator app (TOTP)" right={
          <Pill tone={p.security.totpEnabled ? "gain" : "muted"}>{p.security.totpEnabled ? "Enabled" : "Off"}</Pill>
        } />
        <Row label="Hardware security keys" right={
          <span className="text-[13px] text-textSecondary">
            {p.security.hardwareKeys.length ? p.security.hardwareKeys.map((k) => k.name).join(", ") : "None"}
          </span>
        } />
        <Row label="Last login" right={<span className="text-[13px] text-textSecondary">{timeAgo(p.security.lastLogin)}</span>} />
        <button
          onClick={() => {
            if (!p.security.accountLocked) void patch({ action: "lock" });
          }}
          className={`w-full px-4 py-3 text-left text-[14px] font-semibold ${p.security.accountLocked ? "text-gain" : "text-loss"}`}
        >
          {p.security.accountLocked ? "Account locked" : "Lock account instantly"}
        </button>
      </Group>

      {/* Devices / sessions */}
      <Group title="Devices & sessions">
        {p.security.devices.map((d) => (
          <div key={d.name} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-[14px] font-medium">{d.name} {d.current && <span className="text-gain">· this device</span>}</p>
              <p className="text-[12px] text-textSecondary">{d.location} · {timeAgo(d.lastActive)}</p>
            </div>
            {!d.current && <button className="text-[13px] text-loss">Revoke</button>}
          </div>
        ))}
      </Group>

      {/* Notifications */}
      <Group title="Notifications">
        {(["transactions", "security", "priceAlerts", "product"] as const).map((k) => (
          <Toggle key={k} label={labelFor(k)} on={p.notifications[k]}
            onClick={() => patch({ notifications: { [k]: !p.notifications[k] } })} />
        ))}
      </Group>

      {/* General */}
      <Group title="General">
        <button onClick={logout} className="w-full px-4 py-3 text-left text-[14px] font-semibold">
          Log out
        </button>
        <button
          onClick={() => confirm("Delete your account? This cannot be undone.") && logout()}
          className="w-full px-4 py-3 text-left text-[14px] font-semibold text-loss"
        >
          Delete account
        </button>
      </Group>

      <p className="px-5 pb-4 pt-2 text-center text-[11px] text-textMuted">Furlpay demo · v0.1.0</p>
    </>
  );
}

function labelFor(k: string) {
  return { transactions: "Transaction alerts", security: "Security alerts", priceAlerts: "Price alerts", product: "Product updates" }[k] ?? k;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 px-5">
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-textSecondary">{title}</h2>
      <div className="overflow-hidden rounded-card bg-surface divide-y divide-white/5">{children}</div>
    </section>
  );
}

function Row({ label, right }: { label: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[14px]">{label}</span>
      {right}
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between px-4 py-3">
      <span className="text-[14px]">{label}</span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
