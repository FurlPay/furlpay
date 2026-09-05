// The FurlPay component library.
//
// Screens import from "@/components/furl". The older kit in components/ui.tsx
// still exists and still works — it is being migrated onto these primitives
// rather than replaced in one move, so no screen breaks mid-migration.

export { FurlButton, FurlSecondaryButton, FurlIconButton } from "./Button";
export type { FurlButtonProps, FurlButtonTone, FurlButtonSize, FurlIconButtonProps } from "./Button";

export {
  FurlScreen,
  FurlCard,
  FurlSectionHeader,
  FurlTopBar,
  FurlBottomSheet,
  FurlDialog,
  FurlSegmented,
} from "./Surfaces";

export { FurlInput, FurlSearchBar, FurlAmountInput } from "./Input";
export type { FurlInputProps, FurlAmountInputProps } from "./Input";

export { FurlBalance, FurlTransactionRow, FurlAssetRow, FurlSummaryRow } from "./Money";
export type { FurlBalanceProps, FurlTransactionRowProps, FurlAssetRowProps } from "./Money";

export { FurlStatusBadge, isInFlight, isTerminal, parseStatus } from "./Status";
export type { MoneyStatus } from "./Status";

export {
  FurlSkeleton,
  FurlSkeletonList,
  FurlEmptyState,
  FurlErrorState,
  FurlOfflineState,
  FurlSuccessState,
} from "./States";

export { FurlChart } from "./Chart";
export type { FurlChartProps } from "./Chart";

export { FurlConfirmationView, FurlSecurityPrompt } from "./Confirm";
export type { FurlConfirmationViewProps, ConfirmationLine } from "./Confirm";

export { FurlTabBar } from "./TabBar";
export { OptionRow } from "./OptionRow";
