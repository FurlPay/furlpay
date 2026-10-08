import type { ReactNode, SVGProps } from "react";
import { BrandLogo } from "@/components/onchain/BrandLogo";

// ---------------------------------------------------------------------------
// FurlPay icon system — one geometric line family for the dark dashboard.
//
//   24×24 grid · 1.6px stroke (configurable) · round caps and joins · no fills,
//   gradients or detail below ~14px · currentColor, so an icon takes its
//   parent's colour; `tone` maps to the dashboard's existing palette only.
//
// The SAME icon always means the SAME thing (IconTransfer is every transfer,
// IconMint every mint, …). Blockchain identity is NOT redrawn here: IconChain
// and the per-chain exports render the official marks verified in
// public/logos/official-onchain (SOURCES.md), never a lookalike.
// ---------------------------------------------------------------------------

export type IconTone = "default" | "muted" | "active" | "success" | "warning" | "danger";

const TONE: Record<IconTone, string> = {
  default: "",
  muted: "text-white/45",
  active: "text-[#00E599]",
  success: "text-[#00E599]",
  warning: "text-[#F5B83D]",
  danger: "text-[#FF4D6D]",
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
  strokeWidth?: number;
  tone?: IconTone;
  /** Accessible name; omit for decorative icons (the default: aria-hidden). */
  title?: string;
}

export type FurlIcon = ((p: IconProps) => ReactNode) & { displayName: string };

function icon(name: string, body: ReactNode): FurlIcon {
  const C = ({ size = 16, strokeWidth = 1.6, tone = "default", title, className = "", ...rest }: IconProps) => (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${TONE[tone]} ${className}`.trim()}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      {...rest}
    >
      {title && <title>{title}</title>}
      {body}
    </svg>
  );
  C.displayName = name;
  return C as FurlIcon;
}

const SHIELD = "M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6z";

// ---- navigation / product areas --------------------------------------------
export const IconAnalytics = icon("IconAnalytics", <path d="M3.5 20.5h17M6 17v-5M10 17V8M14 17v-6M18 17V5" />);
export const IconOverview = icon("IconOverview", <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5" /><rect x="13.5" y="11" width="7" height="9.5" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /></>);
export const IconPayments = icon("IconPayments", <><circle cx="12" cy="12" r="3.2" /><path d="M4.2 9.2A8.2 8.2 0 0 1 18.6 6M18.8 3.2V6.3h-3.1M19.8 14.8A8.2 8.2 0 0 1 5.4 18M5.2 20.8v-3.1h3.1" /></>);
export const IconWallet = icon("IconWallet", <><path d="M5 7.5A2.5 2.5 0 0 1 7.5 5H17v3" /><rect x="4" y="8" width="16" height="11.5" rx="2" /><path d="M16 13.75h2" /></>);
export const IconCard = icon("IconCard", <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h4" /></>);
export const IconTravel = icon("IconTravel", <path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z" />);
export const IconUsers = icon("IconUsers", <><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.8a3 3 0 0 1 0 5.6M20.5 19a5 5 0 0 0-3-4.6" /></>);
export const IconMerchant = icon("IconMerchant", <path d="M4.5 10v9.5h15V10M3 9.5 5 4.5h14l2 5M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M10 19.5V15h4v4.5" />);
export const IconCompliance = icon("IconCompliance", <><path d={SHIELD} /><path d="m9 12 2.2 2.2L15.5 10" /></>);
export const IconRisk = icon("IconRisk", <><path d={SHIELD} /><path d="M12 8.5v4.2M12 15.9v.1" /></>);
export const IconCounterparties = icon("IconCounterparties", <><circle cx="6" cy="7" r="2.3" /><circle cx="18" cy="7" r="2.3" /><circle cx="12" cy="18" r="2.3" /><path d="M8.3 7h7.4M7.2 9l3.6 7M16.8 9l-3.6 7" /></>);
export const IconChainAnalytics = icon("IconChainAnalytics", <><rect x="3" y="9" width="7" height="7" rx="1.4" /><rect x="14" y="9" width="7" height="7" rx="1.4" /><path d="M10 12.5h4M6.5 9V6M17.5 9V6M6.5 16v2.5M17.5 16v2.5" /></>);
export const IconStablecoinMarket = icon("IconStablecoinMarket", <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.6 3.7 5.4 3.7 8.5s-1.3 5.9-3.7 8.5c-2.4-2.6-3.7-5.4-3.7-8.5S9.6 6.1 12 3.5z" /></>);
export const IconReports = icon("IconReports", <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 15.5h6M9 8.5h2" /></>);
export const IconApi = icon("IconApi", <path d="M8 8 4 12l4 4M16 8l4 4-4 4M13.5 5.5l-3 13" />);
export const IconIntegrations = icon("IconIntegrations", <path d="M9 3v4M15 3v4M6 7h12v3.5a6 6 0 0 1-12 0zM12 16.5V21" />);
export const IconDocs = icon("IconDocs", <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5M8.5 7.5h7" /></>);
export const IconSettings = icon("IconSettings", <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6" /></>);
export const IconTokenizedAssets = icon("IconTokenizedAssets", <path d="M3 9.5 12 4l9 5.5M5 9.5V18M9.5 9.5V18M14.5 9.5V18M19 9.5V18M3 20.5h18" />);

// ---- header / chrome -------------------------------------------------------
export const IconSearch = icon("IconSearch", <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></>);
export const IconBell = icon("IconBell", <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" />);
export const IconProfile = icon("IconProfile", <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></>);
export const IconInfo = icon("IconInfo", <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 7.9v.1" /></>);
export const IconRefresh = icon("IconRefresh", <path d="M19.5 11A7.8 7.8 0 0 0 5.6 6.6M4.5 4v4h4M4.5 13a7.8 7.8 0 0 0 13.9 4.4M19.5 20v-4h-4" />);
export const IconMenu = icon("IconMenu", <path d="M4 7h16M4 12h16M4 17h16" />);

// ---- onchain intelligence --------------------------------------------------
export const IconOnchain = icon("IconOnchain", <><path d="m12 3 7.8 4.5v9L12 21l-7.8-4.5v-9z" /><circle cx="12" cy="12" r="2.5" /></>);
export const IconUsdc = icon("IconUsdc", <><circle cx="12" cy="12" r="8.5" /><path d="M14.6 9.4c-.5-.9-1.4-1.4-2.6-1.4-1.6 0-2.7.8-2.7 2s1 1.7 2.7 2 2.9.8 2.9 2.1-1.2 2.1-2.9 2.1c-1.2 0-2.2-.6-2.7-1.5M12 6.4v1.6M12 16.2v1.4" /></>);
export const IconNetwork = icon("IconNetwork", <><circle cx="12" cy="12" r="3" /><circle cx="4.8" cy="5.5" r="1.7" /><circle cx="19.2" cy="5.5" r="1.7" /><circle cx="12" cy="20.3" r="1.7" /><path d="m6.1 6.7 3.7 3.2M17.9 6.7l-3.7 3.2M12 15v3.6" /></>);
export const IconTransfer = icon("IconTransfer", <path d="M4 8.5h14M14.5 5 18 8.5 14.5 12M20 15.5H6M9.5 12 6 15.5 9.5 19" />);
export const IconTransfers = icon("IconTransfers", <path d="M4 6.5h11M4 12h15M16.5 9.5 19 12l-2.5 2.5M4 17.5h11" />);
export const IconMint = icon("IconMint", <><circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" /></>);
export const IconBurn = icon("IconBurn", <path d="M12 3c.5 3.2 4.6 5 4.6 9.5a4.6 4.6 0 0 1-9.2 0c0-2 1-3.2 2-4 .2 1.6 1 2.5 2 2.8C11 9 11 6 12 3z" />);
export const IconSender = icon("IconSender", <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 9.4-3.9M15 16h6M18.5 13.5 21 16l-2.5 2.5" /></>);
export const IconReceiver = icon("IconReceiver", <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 9.4-3.9M21 16h-6M17.5 13.5 15 16l2.5 2.5" /></>);
export const IconEvents = icon("IconEvents", <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />);
export const IconBlock = icon("IconBlock", <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9" />);
export const IconIndex = icon("IconIndex", <><ellipse cx="12" cy="6" rx="7.5" ry="2.8" /><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" /></>);
export const IconRpc = icon("IconRpc", <><rect x="4" y="4" width="16" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="16" height="6.5" rx="1.5" /><path d="M7.5 7.25h.1M7.5 16.75h.1M11 7.25h5.5M11 16.75h5.5" /></>);
export const IconProcessing = icon("IconProcessing", <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />);
export const IconChainHealth = icon("IconChainHealth", <><path d={SHIELD} /><path d="M8 12.5h2l1-2.5 2 5 1-2.5h2" /></>);
export const IconDegraded = icon("IconDegraded", <path d="M12 4 21 19.5H3zM12 10v4M12 16.8v.1" />);
export const IconLive = icon("IconLive", <><circle cx="12" cy="12" r="2.4" /><path d="M7.6 7.6a6.2 6.2 0 0 0 0 8.8M16.4 7.6a6.2 6.2 0 0 1 0 8.8M4.7 4.7a10.3 10.3 0 0 0 0 14.6M19.3 4.7a10.3 10.3 0 0 1 0 14.6" /></>);
export const IconFinalized = icon("IconFinalized", <><circle cx="12" cy="12" r="8.5" /><path d="m8.3 12.2 2.5 2.5 4.9-5" /></>);
export const IconHistory = icon("IconHistory", <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5v3.4h3.4M12 8v4.2l2.8 1.8" />);
export const IconRanking = icon("IconRanking", <path d="M4 6h16M4 12h11M4 18h6" />);
export const IconIntegrity = icon("IconIntegrity", <><path d={SHIELD} /><rect x="9.5" y="11" width="5" height="4" rx=".8" /><path d="M10.5 11V9.8a1.5 1.5 0 0 1 3 0V11" /></>);
export const IconHash = icon("IconHash", <path d="M9.5 4 7.5 20M16.5 4l-2 16M4.5 9h16M3.5 15h16" />);
export const IconAmount = icon("IconAmount", <><ellipse cx="12" cy="6.5" rx="7" ry="2.5" /><path d="M5 6.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5M5 11.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5" /></>);
export const IconCrossChain = icon("IconCrossChain", <path d="M3 17.5h18M5 17.5V13a7 7 0 0 1 14 0v4.5M9 17.5v-3M15 17.5v-3" />);
export const IconCctp = icon("IconCctp", <><circle cx="9" cy="12" r="5.5" /><circle cx="15" cy="12" r="5.5" /></>);
export const IconSupplyChange = icon("IconSupplyChange", <path d="M12 4v16M8.5 7.5 12 4l3.5 3.5M8.5 16.5 12 20l3.5-3.5" />);
export const IconLink = icon("IconLink", <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />);

// ---- payment analytics -----------------------------------------------------
export const IconTotalVolume = icon("IconTotalVolume", <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12h.1" /></>);
export const IconTransactions = icon("IconTransactions", <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" />);
export const IconRecipients = icon("IconRecipients", <><circle cx="10" cy="8" r="3.3" /><path d="M3.5 19.5a6.5 6.5 0 0 1 10.5-5.1M18 13v6M15.5 16.5 18 19l2.5-2.5" /></>);
export const IconFees = icon("IconFees", <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="m9 15 6-6" /><circle cx="9.5" cy="9.5" r="1" /><circle cx="14.5" cy="14.5" r="1" /></>);
export const IconPaymentVolume = icon("IconPaymentVolume", <><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" /><path d="M8 16v-3M12 16V9M16 16v-5" /></>);
export const IconByChain = icon("IconByChain", <><rect x="4" y="4" width="6" height="6" rx="1.2" /><rect x="4" y="14" width="6" height="6" rx="1.2" /><path d="M13.5 7h6.5M13.5 17h6.5M7 10v4" /></>);
export const IconStablecoinFlows = icon("IconStablecoinFlows", <><circle cx="12" cy="12" r="8.5" /><path d="M5.5 15.5C9.5 14.5 12.5 11.5 14 7M11.5 7H14v2.5" /></>);
export const IconCategories = icon("IconCategories", <><path d="M3.5 12.5V4.5h8l8.5 8.5-8 8z" /><circle cx="8" cy="9" r="1.3" /></>);
export const IconActivity = icon("IconActivity", <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />);
export const IconTransactionFlow = icon("IconTransactionFlow", <path d="M4 7h5.5l5 10H20M4 17h5.5l1.6-3.2M13 10.2 14.5 7H20M17 4.5 20 7l-3 2.5M17 14.5l3 2.5-3 2.5" />);
export const IconMarketInsights = icon("IconMarketInsights", <><path d="m4 17 5-5 4 3 7-8" /><path d="M4 20.5h16" /></>);

// ---- risk & compliance -----------------------------------------------------
export const IconRiskLow = icon("IconRiskLow", <><path d={SHIELD} /><path d="m9 12 2.2 2.2L15.5 10" /></>);
export const IconRiskMedium = icon("IconRiskMedium", <><path d={SHIELD} /><path d="M9 12.5h6" /></>);
export const IconRiskHigh = icon("IconRiskHigh", <><path d={SHIELD} /><path d="M12 8.5v4.2M12 15.9v.1" /></>);
export const IconFlagged = icon("IconFlagged", <path d="M5.5 21V4M5.5 4h12l-2.5 4 2.5 4h-12" />);
export const IconSanctions = icon("IconSanctions", <path d="M3 9.5 12 4l9 5.5M5 9.5V18M9.5 9.5V18M14.5 9.5V18M19 9.5V18M3 20.5h18" />);
export const IconCritical = icon("IconCritical", <path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2zM12 8v5M12 16v.1" />);
export const IconRiskScore = icon("IconRiskScore", <path d="M4 16.5a8 8 0 0 1 16 0M12 16.5l3.8-4.8M4 16.5h1.5M18.5 16.5H20M12 8.5v1.2" />);
export const IconMonitoring = icon("IconMonitoring", <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>);
export const IconAudit = icon("IconAudit", <><path d="M14 3H6v18h6M14 3l4 4v3.5" /><circle cx="16" cy="16" r="3" /><path d="m18.2 18.2 2.3 2.3" /></>);

// ---- stablecoin market -----------------------------------------------------
export const IconSupply = icon("IconSupply", <><ellipse cx="12" cy="5.5" rx="7" ry="2.5" /><path d="M5 5.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4M5 9.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4M5 13.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4" /></>);
export const IconGrowth = icon("IconGrowth", <path d="m4 17 5-5 3.5 3.5L20 8M15 8h5v5" />);
export const IconDailyVolume = icon("IconDailyVolume", <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 9.5h16M8 3v4M16 3v4M9 17v-3M12 17v-5M15 17v-2" /></>);
export const IconAverageSize = icon("IconAverageSize", <><circle cx="12" cy="12" r="8.5" /><path d="M8 12c1.3-1.3 2.7-1.3 4 0s2.7 1.3 4 0" /></>);
export const IconMarketCap = icon("IconMarketCap", <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5V12h8.5" /></>);
export const IconGlobalFlows = IconStablecoinFlows;
export const IconGeography = icon("IconGeography", <><path d="M12 21s6.5-5.9 6.5-11.5a6.5 6.5 0 0 0-13 0C5.5 15.1 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.3" /></>);
export const IconMarketTrend = icon("IconMarketTrend", <><path d="M7 4v16M17 4v16" /><rect x="5" y="8" width="4" height="7" rx=".6" /><rect x="15" y="6" width="4" height="9" rx=".6" /><path d="M12 9v8" /></>);

// ---- blockchain identity (official marks, never redrawn) -------------------
export function IconChain({ chain, size = 20, className = "" }: { chain: string; size?: number; className?: string }) {
  return <BrandLogo kind="chain" id={chain} size={size} className={className} />;
}
export const IconEthereum = ({ size = 20, className = "" }: { size?: number; className?: string }) => <IconChain chain="ethereum" size={size} className={className} />;
export const IconBase = ({ size = 20, className = "" }: { size?: number; className?: string }) => <IconChain chain="base" size={size} className={className} />;
export const IconArbitrum = ({ size = 20, className = "" }: { size?: number; className?: string }) => <IconChain chain="arbitrum" size={size} className={className} />;
export const IconPolygon = ({ size = 20, className = "" }: { size?: number; className?: string }) => <IconChain chain="polygon" size={size} className={className} />;
export const IconSolana = ({ size = 20, className = "" }: { size?: number; className?: string }) => <IconChain chain="solana" size={size} className={className} />;
