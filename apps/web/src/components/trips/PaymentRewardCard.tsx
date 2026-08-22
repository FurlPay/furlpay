import { Check, Sparkles } from "lucide-react";
import { UsdcCoin } from "./icons";
import styles from "./trips.module.css";
import { formatAmount, type Trip } from "@/lib/trips/demoTrip";

/** Settlement receipt for the booking: what was paid, in what, and what it earned. */
export default function PaymentRewardCard({ trip }: { trip: Trip }) {
  const { payment } = trip;
  return (
    <div className={`${styles.glassWarm} px-[20px] pb-[20px] pt-[18px] sm:px-[26px] sm:pb-[22px] sm:pt-[20px]`}>
      <div className="flex items-center gap-[13px]">
        <span className="flex h-[27px] w-[27px] items-center justify-center rounded-full bg-[#217A47]">
          <Check className="h-[15px] w-[15px] text-white" strokeWidth={3} />
        </span>
        <span className="text-[17px] font-medium uppercase tracking-[0.045em] text-[#4FBF83] sm:text-[20px]">
          Paid with FurlPay
        </span>
      </div>

      <div className="mt-[20px] flex items-center justify-between">
        <span className="flex min-w-0 items-center gap-[11px] sm:gap-[14px]">
          <UsdcCoin size={32} />
          <span className="text-[clamp(24px,7vw,30px)] font-bold leading-none tracking-[-0.02em] text-white sm:text-[38px]">
            {payment.currency}
          </span>
        </span>
        <span className="shrink-0 text-[clamp(24px,7vw,30px)] font-bold leading-none tracking-[-0.02em] text-white sm:text-[38px]">
          {formatAmount(payment.amount)}
        </span>
      </div>

      <div className="mt-[20px] flex items-center justify-between">
        <p className="text-[17px] leading-none text-[#63C793] sm:text-[20px]">
          <span className="font-bold text-fp-bright">{payment.rewardsRate}%</span> FurlPay Rewards
        </p>
        <Sparkles className="h-[19px] w-[19px] text-[#7FE0AB]" strokeWidth={1.8} />
      </div>
    </div>
  );
}
