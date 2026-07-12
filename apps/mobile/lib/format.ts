export function usd(n: number, opts: { sign?: boolean } = {}): string {
  const formatted = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
  if (!opts.sign) return n < 0 ? `-${formatted}` : formatted;
  return `${n < 0 ? "-" : "+"}${formatted}`;
}

export function shortAddress(addr: string | undefined | null, chars = 6): string {
  if (!addr) return "";
  if (addr.length <= chars * 2 + 2) return addr;
  return `${addr.slice(0, chars + 2)}…${addr.slice(-4)}`;
}

export function timeAgo(iso: string | number): string {
  const then = typeof iso === "number" ? iso : Date.parse(iso);
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function txDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
