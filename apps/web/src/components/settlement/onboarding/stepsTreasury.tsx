"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bell, Building2, Check, Copy, Landmark, Plus, Route, Settings2, ShieldCheck, Split, Trash2, Wallet, Zap } from "lucide-react";
import { ASSETS, NETWORKS, UNAVAILABLE_ASSETS, UNAVAILABLE_NETWORKS, type Asset, type Network } from "@/lib/settlement/model";
import { settlementSchema, treasurySchema } from "@/lib/settlement/onboarding";
import { MAX_RULES, nextRulePercent, parsePercent, previewAmounts, summarize } from "@/lib/settlement/split";
import { api, ASSET_NAME, AssetLogo, Badge, ChainLogo, chainName, Choice, Field, Notice, Toggle } from "../os/primitives";
import type { StepProps } from "./OnboardingApp";
import { Layout, nextStep, prevStep, ProgressCard, RailList, StepActions, StepHeader, useStep } from "./shared";

const EVM: Network[] = ["arbitrum", "base", "ethereum", "polygon"];
const NETWORK_HINT: Record<Network, string> = { arbitrum: "EVM · Ethereum L2", base: "EVM · Ethereum L2", ethereum: "EVM · Mainnet", solana: "Solana", polygon: "EVM · Polygon PoS" };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The account's verified linked wallet (EVM only today), from the wallet service. */
function useLinkedWallet() {
  const [state, setState] = useState<{ loading: boolean; address: string | null; detail: string; error: string }>({ loading: true, address: null, detail: "", error: "" });
  useEffect(() => {
    const ac = new AbortController();
    api<{ linked: { address: string } | null; detail?: string }>("/api/wallet/balances", { signal: ac.signal })
      .then((r) => setState({ loading: false, address: r.linked?.address ?? null, detail: r.detail ?? "", error: "" }))
      .catch((e) => !ac.signal.aborted && setState({ loading: false, address: null, detail: "", error: /not_enabled/i.test(e.message) ? "On-chain balance reads are not enabled on this deployment, so wallet connection status cannot be read." : e.message }));
    return () => ac.abort();
  }, []);
  return state;
}

type Treasury = { networks: Network[]; assets: Asset[]; destination: "treasury" | "virtual_account" | "split" };

export function TreasuryStep(p: StepProps) {
  const saved = (p.view.state.drafts?.treasury ?? p.view.state.treasury) as Partial<Treasury> | undefined;
  const s = useStep<Treasury>(p, "treasury", treasurySchema, { networks: saved?.networks ?? [], assets: saved?.assets ?? [], destination: saved?.destination ?? "treasury" });
  const [tab, setTab] = useState<"wallets" | "accounts" | "settings">("wallets");
  const [copied, setCopied] = useState("");
  const linked = useLinkedWallet();
  const d = s.draft;
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const connected = (n: Network) => (EVM.includes(n) ? linked.address : null);
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(""), 1500);
  };
  const destination = (
    <section className="os-section">
      <div className="os-section-head">
        <div>
          <h2>
            <span className="os-num">3</span>Default Settlement Destination
          </h2>
          <p>Choose where incoming payments should be settled by default.</p>
        </div>
      </div>
      <div className="os-choice-row os-three" role="radiogroup" aria-label="Default settlement destination">
        <Choice checked={d.destination === "treasury"} onSelect={() => s.set("destination", "treasury")} title="FurlPay Treasury" hint="Hold in your FurlPay account" />
        <Choice checked={false} disabled onSelect={() => undefined} title="Virtual Account" hint="Needs a virtual account provider" />
        <Choice checked={d.destination === "split"} onSelect={() => s.set("destination", "split")} title="Custom Split" hint="Use programmable rules" />
      </div>
    </section>
  );
  return (
    <Layout
      main={
        <>
          <StepHeader step="treasury" title="Set Up Treasury" subtitle="Configure your wallets, virtual accounts and treasury preferences." />
          <div className="os-tabbar" role="tablist" aria-label="Treasury setup">
            <button role="tab" type="button" aria-selected={tab === "wallets"} onClick={() => setTab("wallets")}>
              <Wallet size={17} /> Wallets & Networks
            </button>
            <button role="tab" type="button" aria-selected={tab === "accounts"} onClick={() => setTab("accounts")}>
              <Landmark size={17} /> Virtual Accounts
            </button>
            <button role="tab" type="button" aria-selected={tab === "settings"} onClick={() => setTab("settings")}>
              <Settings2 size={17} /> Treasury Settings
            </button>
          </div>

          {tab === "wallets" && (
            <>
              <section className="os-section">
                <div className="os-section-head">
                  <div>
                    <h2>
                      <span className="os-num">1</span>Connect Wallets
                    </h2>
                    <p>Choose the networks you want to use for receiving and sending payments.</p>
                  </div>
                  <button type="button" className="os-btn os-btn-sm" onClick={() => s.set("networks", [...NETWORKS])}>
                    Enable all networks
                  </button>
                </div>
                {linked.error && <Notice tone="info">{linked.error}</Notice>}
                <div className="os-tiles" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  {NETWORKS.map((n) => {
                    const addr = connected(n);
                    const on = d.networks.includes(n);
                    return (
                      <div key={n} className="os-tile" style={{ borderColor: on ? "#00c88866" : undefined }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <ChainLogo chain={n} size={30} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600 }}>{chainName(n)}</div>
                            <small style={{ color: addr ? "var(--os-accent)" : "var(--os-muted)" }}>{linked.loading ? "Checking…" : addr ? "● Connected" : "Not connected"}</small>
                          </div>
                          <Toggle checked={on} onChange={() => s.set("networks", toggle(d.networks, n))} label={`Use ${chainName(n)}`} />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, minHeight: 28 }}>
                          {addr ? (
                            <>
                              <span className="mono" style={{ color: "var(--os-muted)", flex: 1 }}>
                                {short(addr)}
                              </span>
                              <button type="button" className="os-icon-btn" style={{ width: 28, height: 28 }} aria-label={`Copy ${chainName(n)} address`} onClick={() => void copy(addr)}>
                                {copied === addr ? <Check size={13} /> : <Copy size={13} />}
                              </button>
                            </>
                          ) : (
                            <small style={{ color: "var(--os-faint)" }}>{NETWORK_HINT[n]}</small>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {UNAVAILABLE_NETWORKS.map((n) => (
                    <div key={n.id} className="os-tile" aria-disabled="true" style={{ opacity: 0.6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <ChainLogo chain={n.id} size={30} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{n.label}</div>
                          <small style={{ color: "var(--os-muted)" }}>Not available</small>
                        </div>
                      </div>
                      <small style={{ display: "block", marginTop: 12, color: "var(--os-faint)" }}>{n.reason}</small>
                    </div>
                  ))}
                  <Link href="/profile" className="os-tile" style={{ borderStyle: "dashed", borderColor: "#00c88855", display: "flex", gap: 12, alignItems: "center" }}>
                    <Plus size={18} color="var(--os-accent)" />
                    <span>
                      <span style={{ color: "var(--os-accent)", fontWeight: 600, display: "block" }}>{linked.address ? "Manage wallet" : "Link a wallet"}</span>
                      <small style={{ color: "var(--os-muted)" }}>{linked.address ? "Verified EVM wallet" : linked.detail || "Verify a wallet you control"}</small>
                    </span>
                  </Link>
                </div>
                {s.errors.networks && <p className="os-field-error" style={{ marginTop: 8 }}>{s.errors.networks}</p>}
              </section>
              <section className="os-section">
                <div className="os-section-head">
                  <div>
                    <h2>
                      <span className="os-num">2</span>Treasury Assets
                    </h2>
                    <p>Select which assets you want to hold in your treasury.</p>
                  </div>
                  <button type="button" className="os-btn os-btn-sm" onClick={() => s.set("assets", [...ASSETS])}>
                    Enable all supported assets
                  </button>
                </div>
                <div className="os-tiles" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
                  {ASSETS.map((a) => (
                    <div key={a} className="os-tile" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <AssetLogo asset={a} size={34} />
                      <span style={{ flex: 1 }}>
                        <strong style={{ marginTop: 0 }}>{a}</strong>
                        <small>{ASSET_NAME[a]}</small>
                      </span>
                      <Toggle checked={d.assets.includes(a)} onChange={() => s.set("assets", toggle(d.assets, a))} label={`Hold ${a}`} />
                    </div>
                  ))}
                  {UNAVAILABLE_ASSETS.map((a) => (
                    <div key={a.id} className="os-tile" aria-disabled="true" title={a.reason} style={{ display: "flex", alignItems: "center", gap: 12, opacity: 0.6 }}>
                      <ChainLogo chain={a.id === "SOL" ? "solana" : "ethereum"} size={34} />
                      <span style={{ flex: 1 }}>
                        <strong style={{ marginTop: 0 }}>{a.id}</strong>
                        <small>{a.reason}</small>
                      </span>
                    </div>
                  ))}
                </div>
                {s.errors.assets && <p className="os-field-error" style={{ marginTop: 8 }}>{s.errors.assets}</p>}
              </section>
              {destination}
            </>
          )}
          {tab === "accounts" && (
            <section className="os-section">
              <Notice tone="info" icon={<Landmark size={16} />}>
                Virtual accounts (named IBANs, ACH and sort-code accounts) need a licensed issuing partner. No virtual account provider is connected to this deployment, so none can be created yet. Your treasury settles to your FurlPay account in the meantime.
              </Notice>
              <Link className="os-btn" href="/settlement/virtual-accounts" style={{ marginTop: 16 }}>
                Open virtual accounts <ArrowRight size={15} />
              </Link>
            </section>
          )}
          {tab === "settings" && destination}

          {s.error && <Notice tone="error">{s.error}</Notice>}
          <StepActions busy={s.busy} onBack={() => p.go(prevStep("treasury"))} onContinue={async () => (await s.save(true)) && p.go(nextStep("treasury"))} />
        </>
      }
      rail={
        <>
          <ProgressCard view={p.view} />
          <RailList
            title="Treasury Benefits"
            items={[
              { icon: <Wallet size={20} />, title: "Multi-chain support", body: "Hold and receive USDC across the networks you enable." },
              { icon: <Split size={20} />, title: "Settlement configuration", body: "Define percentage splits and a default destination for incoming payments." },
              { icon: <ShieldCheck size={20} />, title: "Verified wallets only", body: "A network shows as connected only after you prove control of the wallet." },
            ]}
          />
          <section className="os-card">
            <h2>Supported Networks</h2>
            <ul className="os-list">
              {NETWORKS.map((n) => (
                <li key={n} style={{ alignItems: "center" }}>
                  <ChainLogo chain={n} size={30} />
                  <span style={{ flex: 1 }}>
                    <strong>{chainName(n)}</strong>
                    <small>{NETWORK_HINT[n]}</small>
                  </span>
                  {connected(n) ? (
                    <Badge>Connected</Badge>
                  ) : (
                    <Link className="os-btn os-btn-sm" href="/profile">
                      Connect
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      }
    />
  );
}

// ── Configure Settlement ───────────────────────────────────────────────────
type Rule = { id: string; percent: number; destination: "treasury" | "vendor" | "reserve" | "custom"; label: string; assets: "all" | Asset[] };
type Settlement = {
  model: "treasury" | "virtual_account" | "split";
  rules: Rule[];
  routing: { network: Network; enabled: boolean; primary: boolean }[];
  preferences: { autoConversion: boolean; networkOptimization: boolean; complianceChecks: boolean };
  notifications: { paymentReceived: boolean; payoutSent: boolean; approvalRequired: boolean; dailySummary: boolean };
  advanced: { manualReviewAboveUsd: number; minimumSettlementUsd: number };
};
const DEST: Record<Rule["destination"], { label: string; hint: string; icon: JSX.Element }> = {
  treasury: { label: "Treasury Account", hint: "Main operating treasury", icon: <Wallet size={18} /> },
  vendor: { label: "Vendor Payments", hint: "Suppliers and operational vendors", icon: <Building2 size={18} /> },
  reserve: { label: "Operating Reserve", hint: "Platform reserves and fees", icon: <ShieldCheck size={18} /> },
  custom: { label: "Custom destination", hint: "Your own label", icon: <Route size={18} /> },
};
const COLORS = ["#00c888", "#4f8ff7", "#a77bf3", "#e8ba72", "#5fd4e0", "#ff7a85", "#c9d4ce", "#7ee0a8", "#f09ad0", "#9aa9ff"];
const rule = (percent: number, destination: Rule["destination"]): Rule => ({ id: crypto.randomUUID(), percent, destination, label: DEST[destination].label, assets: "all" });
const TEMPLATES: { name: string; build: () => Rule[] }[] = [
  { name: "Hold everything in treasury (100%)", build: () => [rule(100, "treasury")] },
  { name: "Marketplace split (80 / 15 / 5)", build: () => [rule(80, "treasury"), rule(15, "vendor"), rule(5, "reserve")] },
  { name: "Treasury and reserve (90 / 10)", build: () => [rule(90, "treasury"), rule(10, "reserve")] },
];

export function SettlementStep(p: StepProps) {
  const enabledNetworks = (p.view.state.treasury?.networks ?? []) as Network[];
  const saved = (p.view.state.drafts?.settlement ?? p.view.state.settlement) as Partial<Settlement> | undefined;
  const defaults: Settlement = {
    model: p.view.state.treasury?.destination === "split" ? "split" : "treasury",
    rules: [rule(100, "treasury")],
    routing: enabledNetworks.map((n, i) => ({ network: n, enabled: true, primary: i === 0 })),
    preferences: { autoConversion: false, networkOptimization: true, complianceChecks: true },
    notifications: { paymentReceived: true, payoutSent: true, approvalRequired: true, dailySummary: false },
    advanced: { manualReviewAboveUsd: 0, minimumSettlementUsd: 0 },
  };
  const s = useStep<Settlement>(p, "settlement", settlementSchema, { ...defaults, ...saved, routing: saved?.routing?.length ? saved.routing : defaults.routing } as Settlement);
  const [tab, setTab] = useState<"rules" | "routing" | "notifications" | "advanced">("rules");
  const [template, setTemplate] = useState("");
  const [amount, setAmount] = useState("1000");
  const d = s.draft;
  // Immediate feedback only; settlementSchema on the server is authoritative.
  const split = summarize(d.rules);
  const total = split.total;
  const setRule = (id: string, patch: Partial<Rule>) => s.set("rules", d.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const setModel = (m: Settlement["model"]) => {
    s.set("model", m);
    if (m !== "split") s.setDraft((x) => ({ ...x, model: m, rules: [rule(100, "treasury")] }));
  };
  const amt = Number(amount);
  const preview = useMemo(() => {
    const values = previewAmounts(d.rules, amt);
    return d.rules.map((r, i) => ({ ...r, color: COLORS[i % COLORS.length], value: values[i], share: split.ruleErrors[i] ? 0 : r.percent }));
  }, [d.rules, amt, split.ruleErrors]);
  const C = 2 * Math.PI * 52;
  let offset = 0;

  return (
    <Layout
      main={
        <>
          <StepHeader step="settlement" title="Configure Settlement" subtitle="Set up how incoming payments should be processed, split and settled." />
          <div className="os-tabbar" role="tablist" aria-label="Settlement configuration">
            <button role="tab" type="button" aria-selected={tab === "rules"} onClick={() => setTab("rules")}>
              <Split size={17} /> Settlement Rules
            </button>
            <button role="tab" type="button" aria-selected={tab === "routing"} onClick={() => setTab("routing")}>
              <Route size={17} /> Routing Preferences
            </button>
            <button role="tab" type="button" aria-selected={tab === "notifications"} onClick={() => setTab("notifications")}>
              <Bell size={17} /> Notifications
            </button>
            <button role="tab" type="button" aria-selected={tab === "advanced"} onClick={() => setTab("advanced")}>
              <Settings2 size={17} /> Advanced
            </button>
          </div>

          {tab === "rules" && (
            <>
              <section className="os-section">
                <div className="os-section-head">
                  <div>
                    <h2>
                      <span className="os-num">1</span>Choose Settlement Model
                    </h2>
                    <p>Define how incoming payments are settled and distributed.</p>
                  </div>
                </div>
                <div className="os-choice-row os-three" role="radiogroup" aria-label="Settlement model">
                  <Choice checked={d.model === "treasury"} onSelect={() => setModel("treasury")} title="FurlPay Treasury" hint="Hold funds in your FurlPay treasury account (recommended)" />
                  <Choice checked={false} disabled onSelect={() => undefined} title="Virtual Account" hint="Needs a virtual account provider" />
                  <Choice checked={d.model === "split"} onSelect={() => setModel("split")} title="Custom Split" hint="Use programmable rules to split to multiple destinations" />
                </div>
              </section>
              <section className="os-section">
                <div className="os-section-head">
                  <div>
                    <h2>
                      <span className="os-num">2</span>Configure Split Rules
                    </h2>
                    <p>Set how incoming payments should be automatically distributed.</p>
                  </div>
                  {d.model === "split" && (
                    <select
                      className="os-select"
                      style={{ width: 230, height: 38 }}
                      aria-label="Use a template"
                      value={template}
                      onChange={(e) => {
                        const t = TEMPLATES.find((x) => x.name === e.target.value);
                        if (t) s.set("rules", t.build());
                        setTemplate("");
                      }}
                    >
                      <option value="">Use a template</option>
                      {TEMPLATES.map((t) => (
                        <option key={t.name}>{t.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                {d.rules.map((r, i) => (
                  <div key={r.id} className="os-split">
                    <div className="os-pct">
                      <input className="os-input" type="number" inputMode="numeric" min={0} max={100} step={1} aria-label="Percentage" aria-invalid={Boolean(split.ruleErrors[i])} value={Number.isFinite(r.percent) ? r.percent : ""} disabled={d.model !== "split"} onChange={(e) => setRule(r.id, { percent: parsePercent(e.target.value) })} />
                      {split.ruleErrors[i] && <small className="os-split-hint" role="alert">{split.ruleErrors[i]}</small>}
                    </div>
                    <ArrowRight size={16} className="os-split-arrow" color="var(--os-muted)" />
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px", height: 52, border: "1px solid var(--os-border)", borderRadius: 10, background: "var(--os-sunk)" }}>
                      <span style={{ color: "var(--os-accent)" }}>{DEST[r.destination].icon}</span>
                      <select className="os-select" style={{ border: 0, background: "none", height: 40, paddingLeft: 0 }} aria-label="Destination" value={r.destination} disabled={d.model !== "split"} onChange={(e) => {
                        const dest = e.target.value as Rule["destination"];
                        setRule(r.id, { destination: dest, label: dest === "custom" ? r.label : DEST[dest].label });
                      }}>
                        {(Object.keys(DEST) as Rule["destination"][]).map((k) => (
                          <option key={k} value={k}>
                            {DEST[k].label}
                          </option>
                        ))}
                      </select>
                      {r.destination === "custom" && <input className="os-input" style={{ height: 36 }} aria-label="Destination label" value={r.label} onChange={(e) => setRule(r.id, { label: e.target.value })} />}
                    </div>
                    <select className="os-select os-split-assets" aria-label="Asset scope" value={r.assets === "all" ? "all" : r.assets[0]} onChange={(e) => setRule(r.id, { assets: e.target.value === "all" ? "all" : [e.target.value as Asset] })}>
                      <option value="all">All assets</option>
                      {(p.view.state.treasury?.assets ?? ASSETS).map((a) => (
                        <option key={a} value={a}>
                          {a} only
                        </option>
                      ))}
                    </select>
                    <button type="button" className="os-icon-btn" aria-label="Delete rule" disabled={d.rules.length <= 1 || d.model !== "split"} onClick={() => s.set("rules", d.rules.filter((x) => x.id !== r.id))}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                  {d.model === "split" ? (
                    <button type="button" className="os-btn os-btn-ghost os-btn-sm" disabled={d.rules.length >= MAX_RULES} onClick={() => s.set("rules", [...d.rules, rule(nextRulePercent(d.rules), "custom")])}>
                      <Plus size={15} /> Add Split Rule
                    </button>
                  ) : (
                    <span style={{ color: "var(--os-muted)" }}>All incoming payments settle to your treasury.</span>
                  )}
                  <div className="os-split-total" data-state={split.valid ? "ok" : "warn"} data-testid="split-total" aria-live="polite">
                    <small>Total</small>
                    <strong className="mono">{total}%</strong>
                    <span>{split.valid ? "Ready" : split.over ? `${split.over}% over allocation` : split.remaining && Object.keys(split.ruleErrors).length === 0 ? `${split.remaining}% remaining` : "Fix the highlighted rules"}</span>
                  </div>
                </div>
                {(s.errors.rules || !split.valid) && <p className="os-split-hint" style={{ marginTop: 8 }}>{s.errors.rules ?? `Your settlement rules must total 100% (currently ${total}%).`}</p>}
              </section>
              <section className="os-section">
                <div className="os-section-head">
                  <div>
                    <h2>
                      <span className="os-num">3</span>Settlement Preferences
                    </h2>
                    <p>Configure additional settlement settings.</p>
                  </div>
                </div>
                <div className="os-tiles" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
                  {(
                    [
                      ["autoConversion", "Auto Conversion", "Convert incoming assets to your preferred currency"],
                      ["networkOptimization", "Network Optimization", "Prefer the lowest-cost enabled network"],
                      ["complianceChecks", "Compliance Checks", "Screen counterparties before settlement"],
                    ] as const
                  ).map(([k, t, h]) => (
                    <div key={k} className="os-tile" style={{ display: "flex", gap: 10 }}>
                      <span style={{ flex: 1 }}>
                        <strong style={{ marginTop: 0 }}>{t}</strong>
                        <small>{h}</small>
                      </span>
                      <Toggle checked={d.preferences[k]} label={t} disabled={k === "complianceChecks"} onChange={(v) => s.set("preferences", { ...d.preferences, [k]: v })} />
                    </div>
                  ))}
                </div>
                <p style={{ marginTop: 8, color: "var(--os-faint)", fontSize: 12 }}>Compliance checks are always on; they are enforced by the server and cannot be switched off.</p>
              </section>
            </>
          )}

          {tab === "routing" && (
            <section className="os-section">
              <div className="os-section-head">
                <div>
                  <h2>Routing & Networks</h2>
                  <p>Networks you enabled in Set Up Treasury. Choose one primary network for incoming payments.</p>
                </div>
              </div>
              {d.routing.length === 0 ? (
                <Notice tone="info">Enable networks in Set Up Treasury first.</Notice>
              ) : (
                <div className="os-rows">
                  {d.routing.map((r) => (
                    <div key={r.network} className="os-row">
                      <ChainLogo chain={r.network} size={30} />
                      <span className="os-row-body">
                        <strong>{chainName(r.network)}</strong>
                        <small>{NETWORK_HINT[r.network]}</small>
                      </span>
                      <Toggle checked={r.enabled} label={`Route via ${chainName(r.network)}`} onChange={(v) => s.set("routing", d.routing.map((x) => (x.network === r.network ? { ...x, enabled: v, primary: v ? x.primary : false } : x)))} />
                      <button type="button" className="os-btn os-btn-sm" aria-pressed={r.primary} disabled={!r.enabled} style={r.primary ? { borderColor: "var(--os-accent)", color: "var(--os-accent)" } : undefined} onClick={() => s.set("routing", d.routing.map((x) => ({ ...x, primary: x.network === r.network })))}>
                        {r.primary ? "Primary" : "Make primary"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {s.errors.routing && <p className="os-field-error" style={{ marginTop: 8 }}>{s.errors.routing}</p>}
            </section>
          )}

          {tab === "notifications" && (
            <section className="os-section">
              <div className="os-rows">
                {(
                  [
                    ["paymentReceived", "Payment received", "When an incoming payment settles"],
                    ["payoutSent", "Payout sent", "When a payout leaves your treasury"],
                    ["approvalRequired", "Approval required", "When a payment is waiting for an approver"],
                    ["dailySummary", "Daily summary", "One email with the previous day's activity"],
                  ] as const
                ).map(([k, t, h]) => (
                  <div key={k} className="os-row">
                    <span className="os-row-body">
                      <strong>{t}</strong>
                      <small>{h}</small>
                    </span>
                    <Toggle checked={d.notifications[k]} label={t} onChange={(v) => s.set("notifications", { ...d.notifications, [k]: v })} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "advanced" && (
            <section className="os-section">
              <div className="os-grid">
                <Field label="Hold for manual review above (USD)" error={s.errors["advanced.manualReviewAboveUsd"]}>
                  <input className="os-input mono" type="number" min={0} step={1} value={d.advanced.manualReviewAboveUsd} onChange={(e) => s.set("advanced", { ...d.advanced, manualReviewAboveUsd: Math.trunc(Number(e.target.value)) })} />
                </Field>
                <Field label="Minimum settlement amount (USD)" error={s.errors["advanced.minimumSettlementUsd"]}>
                  <input className="os-input mono" type="number" min={0} step={1} value={d.advanced.minimumSettlementUsd} onChange={(e) => s.set("advanced", { ...d.advanced, minimumSettlementUsd: Math.trunc(Number(e.target.value)) })} />
                </Field>
              </div>
              <p style={{ marginTop: 10, color: "var(--os-faint)", fontSize: 12 }}>0 means no threshold.</p>
            </section>
          )}

          <Notice tone="info">No settlement service executes these rules on this deployment yet. They are saved as your account’s settlement configuration and shown on Settlement Overview.</Notice>
          {s.error && <Notice tone="error">{s.error}</Notice>}
          <StepActions busy={s.busy} onBack={() => p.go(prevStep("settlement"))} onContinue={async () => (await s.save(true)) && p.go(nextStep("settlement"))} disabled={!split.valid} />
        </>
      }
      rail={
        <>
          <ProgressCard view={p.view} />
          <section className="os-card">
            <div className="os-section-head" style={{ marginBottom: 6 }}>
              <h2>Settlement Preview</h2>
              <Badge tone="muted">Preview</Badge>
            </div>
            <small style={{ color: "var(--os-muted)", display: "block" }}>Configured — not executing. This illustrates how a payment would be split; no funds move.</small>
            <label className="os-rail-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Example incoming payment
              <input className="os-input mono" style={{ height: 34, width: 120 }} type="number" min={0} aria-label="Example payment amount in USDC" value={amount} onChange={(e) => setAmount(e.target.value)} />
              USDC
            </label>
            <div style={{ display: "flex", gap: 20, alignItems: "center", marginTop: 18 }}>
              <svg viewBox="0 0 130 130" width="140" height="140" role="img" aria-label="Settlement split preview">
                <circle cx="65" cy="65" r="52" fill="none" stroke="#1c2621" strokeWidth="13" />
                {total > 0 &&
                  preview.map((r) => {
                    const len = (r.share / Math.max(100, total)) * C;
                    const el = <circle key={r.id} cx="65" cy="65" r="52" fill="none" stroke={r.color} strokeWidth="13" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 65 65)" />;
                    offset += len;
                    return el;
                  })}
                <text x="65" y="64" textAnchor="middle" fill="var(--os-text)" style={{ font: "600 19px 'JetBrains Mono', monospace" }}>
                  {Number.isFinite(amt) ? amt.toLocaleString("en-US") : "—"}
                </text>
                <text x="65" y="82" textAnchor="middle" fill="var(--os-muted)" style={{ font: "500 11px Inter" }}>
                  USDC
                </text>
              </svg>
              <ul className="os-donut-legend" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {preview.map((r) => (
                  <li key={r.id}>
                    <span className="os-swatch" style={{ background: r.color }} />
                    <span>
                      <strong style={{ display: "block", fontWeight: 550 }}>{r.label}</strong>
                      <small className="mono" style={{ color: "var(--os-muted)" }}>
                        {r.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC ({r.percent}%)
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
          <RailList
            title="Key Benefits"
            items={[
              { icon: <Split size={20} />, title: "Stored with your account", body: "Your split, routing and notification choices are saved to your account." },
              { icon: <Zap size={20} />, title: "Multi-chain support", body: "Route through the networks you enabled, with one primary." },
              { icon: <ShieldCheck size={20} />, title: "Validated on the server", body: "Rules that do not total 100% are refused, not silently rounded." },
            ]}
          />
        </>
      }
    />
  );
}
