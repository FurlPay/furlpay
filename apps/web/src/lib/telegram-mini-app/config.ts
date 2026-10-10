/**
 * FurlPay hosted merchant checkout (/p/<id>) is not part of this release line;
 * it ships with merchant payments. Until then the mini app must not invite
 * people to paste a payment link it cannot open.
 */
export const PAYMENT_LINKS_AVAILABLE = false;
export const TELEGRAM_EMBED_CONTEXT_HEADER = "x-furlpay-telegram-embedded";

/** Public navigation hints only. Never put an account, token or payment in a start parameter. */
export const MINI_APP_ROUTES = {
  home: "/telegram/home", cards: "/telegram/cards", pay: "/telegram/pay",
  activity: "/telegram/activity", profile: "/telegram/profile", wallet: "/telegram/wallet",
  travel: "/telegram/travel", discover: "/telegram",
} as const;

export function telegramStartRoute(value: string | null | undefined): string | null {
  if (!value || !Object.prototype.hasOwnProperty.call(MINI_APP_ROUTES, value)) return null;
  return MINI_APP_ROUTES[value as keyof typeof MINI_APP_ROUTES];
}

export function telegramLaunchUrl(start = "discover", username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME, shortName = process.env.NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME): string | null {
  if (!username || !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username) || !/bot$/i.test(username)) return null;
  if (shortName && !/^[A-Za-z0-9_]{3,64}$/.test(shortName)) return null;
  if (!telegramStartRoute(start)) return null;
  return `https://t.me/${username}${shortName ? `/${shortName}` : ""}?startapp=${start}`;
}
