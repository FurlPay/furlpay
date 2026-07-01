"use client";

import { useCallback, useEffect, useState } from "react";
import { getJSON, sendJSON } from "@/lib/api";
import { FiatBalance } from "@/lib/types";
import { PageHeader, Pill, Spinner, usd } from "@/components/ui";
import { PlusIcon } from "@/components/icons";

export default function BankingPage() {
  const [accounts, setAccounts] = useState<FiatBalance[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => {
    getJSON<{ accounts: FiatBalance[] }>("/api/banking").then((r) => setAccounts(r.accounts));
  }, []);
  useEffect(() => load(), [load]);

  async function provision(currency: string) {
    setBusy(true);
    try {
      await sendJSON("/api/banking", { currency });
      load();
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1200);
  }

  if (!accounts.length) return <Spinner />;

  const missing = ["USD", "EUR", "GBP", "INR"].filter((c) => !accounts.find((a) => a.currency === c));

  return (
    <>
      <PageHeader title="Banking" right={<Pill tone="accent">Wise · BaaS</Pill>} />

      <div className="space-y-3 px-5">
        {accounts.map((a) => (
          <div key={a.currency} className="surface-card p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] text-textSecondary">{a.currency} account</p>
                <p className="mt-1 text-2xl font-bold">
                  {a.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
                  <span className="text-base font-medium text-textSecondary">{a.currency}</span>
                </p>
                <p className="text-[12px] text-textMuted">≈ {usd(a.usdValue)}</p>
              </div>
            </div>
            {a.localDetails && (
              <div className="mt-3 space-y-1.5 rounded-2xl bg-white/[0.04] p-3">
                {Object.entries(a.localDetails).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => copy(String(v))}
                    className="flex w-full items-center justify-between text-left text-[13px]"
                  >
                    <span className="capitalize text-textSecondary">{k.replace(/([A-Z])/g, " $1")}</span>
                    <span className="font-mono">{copied === String(v) ? "Copied" : String(v)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {missing.length > 0 && (
        <section className="mt-6 px-5">
          <h2 className="mb-2 text-lg font-bold">Open a new account</h2>
          <div className="flex flex-wrap gap-2">
            {missing.map((c) => (
              <button
                key={c}
                disabled={busy}
                onClick={() => provision(c)}
                className="flex items-center gap-1.5 rounded-pill border border-surfaceMuted bg-surface px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                <PlusIcon className="h-4 w-4" /> {c}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-textMuted">
            Virtual IBAN / routing details are sub-accounts under Furlpay&apos;s BaaS partner
            (Cross River / Wise), held in FDIC-insured or safeguarded omnibus accounts.
          </p>
        </section>
      )}
    </>
  );
}
