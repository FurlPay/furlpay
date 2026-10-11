"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowUpRight, Check, Copy, Inbox, X } from "lucide-react";

export const formatNumber = (amount: number, decimals = 2) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
export const usd = (amount: number) => `$${formatNumber(amount)}`;
export const humanize = (value: string) =>
  value.replace(/[_-]/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
export function downloadFile(
  name: string,
  content: string,
  type = "text/plain"
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AssetMark({
  asset = "USDC",
  network,
}: {
  asset?: string;
  network?: string;
}) {
  const coins = ["USDC", "USDT", "EURC", "ETH", "SOL"];
  const chains = [
    "arbitrum",
    "ethereum",
    "solana",
    "polygon",
    "optimism",
    "avalanche",
  ];
  return (
    <span className="st-asset-mark">
      {coins.includes(asset) ? (
        <img
          src={`/logos/coins/${asset.toLowerCase()}.svg`}
          alt={asset}
          width={32}
          height={32}
        />
      ) : (
        <span>
          {({ EUR: "€", USD: "$", GBP: "£" } as Record<string, string>)[
            asset
          ] || asset.slice(0, 1)}
        </span>
      )}
      {network && chains.includes(network) && (
        <img
          className="st-chain-mark"
          src={`/logos/chains/${network}.svg`}
          alt={humanize(network)}
          width={14}
          height={14}
        />
      )}
      {network === "base" && (
        <span className="st-chain-mark st-base" title="Base">
          B
        </span>
      )}
    </span>
  );
}
export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "green" | "amber" | "red" | "muted" | "blue";
}) {
  return (
    <span className={`st-badge st-${tone}`}>
      <span />
      {children}
    </span>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <Badge
      tone={
        value === "settled" || value === "approved"
          ? "green"
          : value === "pending" || value === "escrow"
          ? "amber"
          : value === "declined"
          ? "red"
          : "muted"
      }
    >
      {humanize(value)}
    </Badge>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="st-empty">
      <span className="st-empty-icon">
        <Inbox size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`st-panel ${className}`}>
      {title && (
        <div className="st-panel-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="st-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function ExternalCard({
  title,
  description,
  href,
  icon,
}: {
  title: string;
  description: string;
  href: string;
  icon: ReactNode;
}) {
  return (
    <a className="st-resource-card" href={href}>
      <span className="st-feature-icon">{icon}</span>
      <h3>
        {title}
        <ArrowUpRight size={17} />
      </h3>
      <p>{description}</p>
    </a>
  );
}
export function Drawer({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="st-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="st-drawer">
        <div className="st-drawer-head">
          <div>
            <span className="st-eyebrow">FURLPAY WORKSPACE</span>
            <h2 id={id}>{title}</h2>
          </div>
          <button
            className="st-icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </div>
        <div className="st-drawer-body">{children}</div>
      </div>
    </dialog>
  );
}
export function CopyButton({
  value,
  onMessage,
}: {
  value: string;
  onMessage: (message: string) => void;
}) {
  return (
    <button
      className="st-button st-small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          onMessage("Copied to clipboard");
        } catch {
          onMessage(
            "Clipboard unavailable. Select and copy the value manually."
          );
        }
      }}
    >
      <Copy size={14} />
      Copy
    </button>
  );
}
export function Checklist({
  items,
}: {
  items: { label: string; done: boolean; detail: string }[];
}) {
  return (
    <div className="st-checklist">
      {items.map((item) => (
        <div key={item.label}>
          <span className={item.done ? "st-check-done" : "st-check-pending"}>
            {item.done ? <Check size={14} /> : "—"}
          </span>
          <div>
            <strong>{item.label}</strong>
            <p>{item.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
