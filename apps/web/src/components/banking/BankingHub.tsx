"use client";

import React, { useEffect, useState } from "react";
import { Landmark, ArrowUpRight, ShieldCheck, HelpCircle, Activity, Globe, Compass, GitCompare, FileText } from "lucide-react";
import { getJSON } from "@/lib/api";

interface Provider {
  id: string;
  name: string;
  category: "retail" | "business" | "virtual";
  depositApy: number;
  promoApy?: number;
  promoLabel?: string;
  logoShort: string;
  requiresMtls: boolean;
  status: "active" | "sandbox" | "coming_soon";
  description: string;
}

/** Returned on every /api/banking/directory response; HKMA's terms of use make
 *  surfacing it mandatory wherever the data is rendered, not optional polish. */
interface HkmaAttribution {
  source: string;
  url: string;
  notice: string;
  commercialUseCleared: boolean;
}

interface HkmaBranch {
  bankName: string;
  branchName: string;
  district: string;
  address: string;
}

const PROVIDERS: Provider[] = [
  {
    id: "hsbc",
    name: "HSBC Hong Kong",
    category: "retail",
    depositApy: 1.25,
    promoApy: 15.5,
    promoLabel: "15.5% Promo Time Deposit (Short-term new money)",
    logoShort: "H",
    requiresMtls: true,
    status: "sandbox",
    description: "Connect retail accounts, live FX feeds, and PayMe instant merchant checkouts.",
  },
  {
    id: "scb",
    name: "Standard Chartered",
    category: "retail",
    depositApy: 1.5,
    logoShort: "S",
    requiresMtls: true,
    status: "sandbox",
    description: "Settle global trade transactions and multi-currency business vaults.",
  },
  {
    id: "bochk",
    name: "Bank of China (Hong Kong)",
    category: "retail",
    depositApy: 1.1,
    logoShort: "B",
    requiresMtls: true,
    status: "sandbox",
    description: "Cross-border RMB clearing and direct CBETS / Project mBridge stablecoin settlements.",
  },
  {
    id: "zabank",
    name: "ZA Bank (Virtual)",
    category: "virtual",
    depositApy: 4.2,
    logoShort: "Z",
    requiresMtls: false,
    status: "active",
    description: "High-yield HKD savings, virtual Visa card issuance, and instant local clearing.",
  },
  {
    id: "citibank",
    name: "Citibank Hong Kong",
    category: "retail",
    depositApy: 1.75,
    logoShort: "C",
    requiresMtls: true,
    status: "coming_soon",
    description: "Global wealth routing, USD/HKD treasury sweeps, and institutional asset custody.",
  },
];

export function BankingHub() {
  const [activeTab, setActiveTab] = useState<"discover" | "compare" | "connect" | "track">("discover");
  const [selectedProvider, setSelectedProvider] = useState<Provider>(PROVIDERS[0]);
  const [branches, setBranches] = useState<HkmaBranch[]>([]);
  const [attribution, setAttribution] = useState<HkmaAttribution | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [connectStatus, setConnectStatus] = useState<string | null>(null);

  // Live regulator data, straight from /api/banking/directory. This used to go
  // through /api/banking/hsbc, which wrapped the same HKMA feed but dropped the
  // attribution block — HKMA's terms require attribution wherever the data is
  // shown, so the route that carries it is the only correct source.
  useEffect(() => {
    async function fetchHkmaData() {
      setLoadingBranches(true);
      try {
        const res = await fetch("/api/banking/directory?type=branches");
        const json = await res.json().catch(() => null);
        if (res.ok && json?.success) {
          setBranches(json.branches?.records ?? []);
          setAttribution(json.attribution ?? null);
        } else {
          // The route fails closed on upstream errors; surface that rather than
          // rendering an empty list that reads as "no branches".
          setBranchError(json?.error ?? "Branch registry unavailable.");
        }
      } catch {
        setBranchError("Branch registry unavailable.");
      } finally {
        setLoadingBranches(false);
      }
    }
    fetchHkmaData();
  }, []);

  async function handleConnectionSetup() {
    setConnectStatus("Initializing OAuth 2.0 PKCE redirection flow...");
    setTimeout(() => {
      if (selectedProvider.requiresMtls) {
        setConnectStatus(
          `Connection Pending: ${selectedProvider.name} requires mTLS / client certificate verification. Sandbox connection authorized.`
        );
      } else {
        setConnectStatus(`Success: Connected to ${selectedProvider.name} API gateway!`);
      }
    }, 1500);
  }

  return (
    <div className="p-6 bg-slate-900/90 backdrop-blur-md rounded-3xl border border-slate-800 text-white space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-800 pb-4 gap-3">
        <div>
          <div className="flex items-center space-x-2">
            <Landmark className="w-5 h-5 text-accent" />
            <h3 className="text-lg font-bold text-white">Banking Orchestration Hub</h3>
          </div>
          <p className="text-xs text-slate-400">
            Connect traditional &amp; virtual banks directly to your FurlPay financial infrastructure
          </p>
        </div>
        <div className="flex bg-slate-800/60 p-0.5 rounded-xl border border-slate-700/50 text-[12px] font-semibold">
          {(["discover", "compare", "connect", "track"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg capitalize transition ${
                activeTab === tab ? "bg-accent text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* DISCOVER TAB */}
      {activeTab === "discover" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5" /> Supported Providers
            </h4>
            <div className="space-y-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProvider(p)}
                  className={`w-full p-4 rounded-2xl border text-left transition flex items-center justify-between ${
                    selectedProvider.id === p.id
                      ? "bg-slate-800/80 border-accent"
                      : "bg-slate-800/30 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <span className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center font-bold text-white text-sm">
                      {p.logoShort}
                    </span>
                    <div>
                      <div className="font-semibold text-sm flex items-center gap-2">
                        {p.name}
                        {p.status === "active" && (
                          <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 text-[9px] font-bold rounded">
                            Live
                          </span>
                        )}
                        {p.status === "sandbox" && (
                          <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 text-[9px] font-bold rounded">
                            Sandbox
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[200px]">
                        {p.description}
                      </div>
                    </div>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-slate-500" />
                </button>
              ))}
            </div>
          </div>

          {/* Provider Detail Panel */}
          <div className="p-5 bg-slate-800/20 rounded-2xl border border-slate-800/60 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                  Provider Details
                </span>
                <span className="px-2 py-0.5 bg-slate-800 rounded-full border border-slate-700 text-[10px] text-slate-300 font-mono">
                  ID: {selectedProvider.id}
                </span>
              </div>
              <h4 className="text-base font-bold">{selectedProvider.name}</h4>
              <p className="text-xs text-slate-400 leading-relaxed">{selectedProvider.description}</p>

              <div className="space-y-2 pt-2">
                <div className="flex justify-between text-xs py-1 border-b border-slate-800">
                  <span className="text-slate-400">Yield Tier (Standard)</span>
                  <span className="font-mono text-emerald-400 font-semibold">
                    {selectedProvider.depositApy.toFixed(2)}% p.a.
                  </span>
                </div>
                {selectedProvider.promoApy && (
                  <div className="flex flex-col text-xs py-1 border-b border-slate-800 gap-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Yield Tier (Promotional)</span>
                      <span className="font-mono text-emerald-300 font-semibold">
                        {selectedProvider.promoApy.toFixed(2)}% p.a.
                      </span>
                    </div>
                    <span className="text-[10px] text-amber-400">{selectedProvider.promoLabel}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs py-1 border-b border-slate-800">
                  <span className="text-slate-400">Auth Scheme</span>
                  <span className="font-mono text-slate-300">
                    {selectedProvider.requiresMtls ? "mTLS + OAuth 2.0" : "OAuth 2.0 PKCE"}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setActiveTab("connect")}
              className="w-full mt-6 py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold text-xs rounded-xl shadow-lg transition"
            >
              Initiate API Connection Flow
            </button>
          </div>
        </div>
      )}

      {/* COMPARE TAB */}
      {activeTab === "compare" && (
        <div className="space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <GitCompare className="w-3.5 h-3.5" /> Compare Bank Yields &amp; Features
          </h4>
          <div className="overflow-x-auto rounded-2xl border border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-800/40 border-b border-slate-800 text-slate-400 font-semibold">
                  <th className="p-3">Bank Name</th>
                  <th className="p-3">Base yield</th>
                  <th className="p-3">Max yield</th>
                  <th className="p-3">Auth required</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {PROVIDERS.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/20">
                    <td className="p-3 font-semibold text-white">{p.name}</td>
                    <td className="p-3 font-mono text-emerald-400">{p.depositApy.toFixed(2)}% p.a.</td>
                    <td className="p-3 font-mono text-emerald-300">
                      {p.promoApy ? `${p.promoApy.toFixed(2)}% p.a.` : "-"}
                    </td>
                    <td className="p-3 text-slate-300">{p.requiresMtls ? "mTLS + OAuth" : "OAuth 2.0"}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          p.status === "active"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : p.status === "sandbox"
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-slate-800 text-slate-500"
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CONNECT TAB */}
      {activeTab === "connect" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-5 bg-slate-800/20 rounded-2xl border border-slate-800/60 space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> API Connection Wizard
            </h4>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Select Bank Provider</label>
                <select
                  value={selectedProvider.id}
                  onChange={(e) =>
                    setSelectedProvider(PROVIDERS.find((p) => p.id === e.target.value) || PROVIDERS[0])
                  }
                  className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-xs text-white font-semibold outline-none"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-700/30 text-xs space-y-2">
                <div className="font-semibold text-slate-300">Connection Requirements:</div>
                <ul className="list-disc pl-4 space-y-1 text-slate-400 text-[11px]">
                  <li>OAuth Client ID &amp; redirect authorization code.</li>
                  {selectedProvider.requiresMtls && (
                    <li className="text-amber-300">
                      Requires mTLS Client Certificate uploaded to FurlPay dashboard.
                    </li>
                  )}
                  <li>Read-only scopes requested: accounts.read, transactions.read.</li>
                </ul>
              </div>

              <button
                onClick={handleConnectionSetup}
                className="w-full py-2.5 bg-accent hover:bg-accent/90 text-white font-semibold text-xs rounded-xl shadow-lg transition"
              >
                Connect {selectedProvider.name}
              </button>

              {connectStatus && (
                <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl font-mono text-[10px] text-emerald-400">
                  {connectStatus}
                </div>
              )}
            </div>
          </div>

          {/* Live Regulator Branch Feed */}
          <div className="p-5 bg-slate-800/20 rounded-2xl border border-slate-800/60 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" /> HKMA Branch Registry
              </h4>
              <span className="text-[10px] text-emerald-400 font-mono">
                {loadingBranches ? "Syncing..." : `${branches.length} Branches`}
              </span>
            </div>

            {loadingBranches ? (
              <div className="flex items-center justify-center h-48">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-accent"></div>
              </div>
            ) : branchError ? (
              <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-amber-300">
                {branchError}
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1 no-scrollbar">
                {branches.slice(0, 4).map((b, idx) => (
                  <div key={idx} className="p-3 bg-slate-800/40 rounded-xl border border-slate-700/20 text-xs">
                    <div className="font-semibold text-white">{b.bankName}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{b.branchName}</div>
                    <div className="text-[10px] text-slate-500 mt-1">{b.address}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Attribution is rendered from the payload rather than retyped here,
                so it cannot drift from what the route actually asserts. */}
            {attribution && (
              <p className="text-[10px] leading-relaxed text-slate-500">
                {attribution.notice}{" "}
                <a href={attribution.url} target="_blank" rel="noreferrer" className="underline hover:text-slate-400">
                  {attribution.source}
                </a>
                {!attribution.commercialUseCleared && " · Non-commercial use; commercial clearance pending."}
              </p>
            )}
          </div>
        </div>
      )}

      {/* TRACK TAB */}
      {activeTab === "track" && (
        <div className="space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Connection Status Logs
          </h4>
          <div className="space-y-3">
            <div className="p-4 bg-slate-800/30 rounded-2xl border border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <div>
                  <div className="text-sm font-semibold">ZA Bank API Gateway</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Connected · Scopes: accounts.read, payments.write</div>
                </div>
              </div>
              <span className="text-xs text-slate-500 font-mono">Ping: 42ms</span>
            </div>

            <div className="p-4 bg-slate-800/30 rounded-2xl border border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <div>
                  <div className="text-sm font-semibold">HSBC Sandbox Gateway</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Unconfigured · Production mTLS keys pending</div>
                </div>
              </div>
              <span className="text-xs text-slate-500 font-mono">Sandbox Mode</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
