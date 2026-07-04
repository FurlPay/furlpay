// FurlPay Travels referral program — in-memory demo.
// Refer a friend → you earn $25 in Travel Credits when they complete their first
// booking; the friend gets $15 off. A live build ties this to real accounts.

export const REFERRER_REWARD = 25;
export const REFEREE_DISCOUNT = 15;

const CODE = "ASHUT0X";

// Shared across route bundles in the same process (see store.ts note).
const state: { code: string; referrals: number; earnedUsd: number; pending: number } =
  ((globalThis as any).__furlpayReferral ??= { code: CODE, referrals: 12, earnedUsd: 300, pending: 3 });

export function referralStats() {
  return {
    code: state.code,
    link: `https://furlpay.com/r/${state.code}`,
    referrals: state.referrals,
    earnedUsd: state.earnedUsd,
    pending: state.pending,
    referrerReward: REFERRER_REWARD,
    refereeDiscount: REFEREE_DISCOUNT,
  };
}

export function trackReferral(code: string, event: "signup" | "first_booking") {
  if (event === "signup") {
    state.pending += 1;
    return { tracked: true, event, refereeDiscountUsd: REFEREE_DISCOUNT };
  }
  // first_booking → convert a pending referral into an earned reward
  if (state.pending > 0) state.pending -= 1;
  state.referrals += 1;
  state.earnedUsd += REFERRER_REWARD;
  return { tracked: true, event, rewardUsd: REFERRER_REWARD, totalEarnedUsd: state.earnedUsd };
}
