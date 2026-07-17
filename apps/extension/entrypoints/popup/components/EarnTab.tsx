import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { compactMoney, tokenMeta } from "@/lib/market";
import type { EarnOverview, RewardsSummary } from "@/lib/types";
import { ErrorPanel, SkeletonPage, openSite, send, usd } from "./shared";

export default function EarnTab() {
  const [earn, setEarn] = useState<EarnOverview | null>(null);
  const [rewards, setRewards] = useState<RewardsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    send<EarnOverview>({ type: "GET_EARN" }).then((r) => (r.ok ? setEarn(r.data) : setError(r.error)));
    send<RewardsSummary>({ type: "GET_REWARDS" }).then((r) => r.ok && setRewards(r.data));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorPanel message={error} onRetry={load} />;
  if (!earn) return <SkeletonPage rows={3} label="Loading vaults and rates…" />;

  return (
    <div style={{ padding: "0 14px" }}>
      <div className="glass-panel fade-up" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="qa-icon" style={{ width: 42, height: 42 }}>
            <Icon name="earn" size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.72rem", color: "var(--fp-text-secondary)" }}>Idle USDC ready to earn</div>
            <div className="balance-amount" style={{ fontSize: "1.3rem" }}>${usd(earn.idleUsdc)}</div>
          </div>
          <span className="pill pill--accent">up to {earn.bestApy.toFixed(1)}% APY</span>
        </div>
        {earn.idleUsdc > 0 && earn.bestApy > 0 && (
          <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--fp-border-glass)" }}>
            Projected at the best rate:{" "}
            <b style={{ color: "var(--fp-accent)", fontFamily: "var(--fp-font-mono)" }}>
              +${usd((earn.idleUsdc * earn.bestApy) / 100)}
            </b>{" "}
            /year · <span style={{ fontFamily: "var(--fp-font-mono)" }}>+${((earn.idleUsdc * earn.bestApy) / 100 / 12).toFixed(2)}</span> /month
          </div>
        )}
      </div>

      <h3 className="section-title">Available vaults</h3>
      {earn.vaults.map((v, i) => {
        const assetSym = v.asset?.symbol ?? "USDC";
        const meta = tokenMeta(assetSym);
        const stableAsset = ["USDC", "USDT", "EURC", "DAI"].includes(assetSym.toUpperCase());
        return (
          <div key={v.symbol} className="glass-panel fade-up" style={{ padding: "12px 14px", marginBottom: 8, animationDelay: `${i * 0.04}s` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="asset-logo" style={{ width: 30, height: 30, background: meta.logo ? undefined : meta.color }}>
                {meta.logo ? <img src={meta.logo} alt="" /> : meta.symbol.slice(0, 2)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "0.85rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.name}</div>
                <div style={{ fontSize: "0.68rem", color: "var(--fp-text-muted)" }}>Morpho · {assetSym}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "var(--fp-font-mono)", fontWeight: 800, fontSize: "1rem", color: "var(--fp-accent)" }}>
                  {v.netApy.toFixed(1)}%
                </div>
                <div style={{ fontSize: "0.6rem", color: "var(--fp-text-muted)" }}>Net APY</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, margin: "10px 0", flexWrap: "wrap" }}>
              {typeof v.tvlUsd === "number" && <span className="pill">TVL {compactMoney(v.tvlUsd)}</span>}
              <span className={`status-badge status-badge--${stableAsset ? "gain" : "warning"}`} style={{ padding: "3px 9px" }}>
                {stableAsset ? "Low risk" : "Medium risk"}
              </span>
              <span className="pill">No lock — withdraw anytime</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-ghost" style={{ flex: 1, padding: "7px", fontSize: "0.74rem" }} onClick={() => openSite("/earn")}>
                Details
              </button>
              <button className="btn-primary" style={{ flex: 1, padding: "7px", fontSize: "0.74rem" }} onClick={() => openSite("/earn")}>
                Deposit
              </button>
            </div>
          </div>
        );
      })}

      {rewards && (
        <>
          <h3 className="section-title" style={{ marginTop: 14 }}>Rewards</h3>
          <div className="glass-panel" style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: "0.78rem", color: "var(--fp-text-secondary)" }}>{rewards.points} pts</span>
              <span className="pill pill--accent">{rewards.tier}</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${rewards.progressPct}%` }} />
            </div>
            <div style={{ fontSize: "0.68rem", color: "var(--fp-text-muted)", marginTop: 6 }}>
              {rewards.progressPct}% to {rewards.nextTier}
            </div>
          </div>
        </>
      )}

      <p style={{ fontSize: "0.62rem", color: "var(--fp-text-muted)", lineHeight: 1.5, marginTop: 10 }}>{earn.disclosure}</p>
    </div>
  );
}
