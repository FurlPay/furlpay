// ---------------------------------------------------------------------------
// Country dial codes for the phone-number input. This is a UI convenience list;
// actual SMS deliverability is decided by the OTP provider (Twilio Verify), which
// covers ~all messaging countries plus China. Add rows freely — nothing here
// gates delivery. Sorted alphabetically by name, with a few high-traffic
// markets duplicated implicitly via search.
// ---------------------------------------------------------------------------

export interface Country {
  iso: string; // ISO 3166-1 alpha-2
  name: string;
  dial: string; // E.164 country calling code, without "+"
  flag: string; // emoji flag
}

export const COUNTRIES: Country[] = [
  { iso: "US", name: "United States", dial: "1", flag: "🇺🇸" },
  { iso: "IN", name: "India", dial: "91", flag: "🇮🇳" },
  { iso: "GB", name: "United Kingdom", dial: "44", flag: "🇬🇧" },
  { iso: "NL", name: "Netherlands", dial: "31", flag: "🇳🇱" },
  { iso: "IE", name: "Ireland", dial: "353", flag: "🇮🇪" },
  { iso: "DE", name: "Germany", dial: "49", flag: "🇩🇪" },
  { iso: "FR", name: "France", dial: "33", flag: "🇫🇷" },
  { iso: "ES", name: "Spain", dial: "34", flag: "🇪🇸" },
  { iso: "IT", name: "Italy", dial: "39", flag: "🇮🇹" },
  { iso: "PT", name: "Portugal", dial: "351", flag: "🇵🇹" },
  { iso: "BE", name: "Belgium", dial: "32", flag: "🇧🇪" },
  { iso: "CH", name: "Switzerland", dial: "41", flag: "🇨🇭" },
  { iso: "AT", name: "Austria", dial: "43", flag: "🇦🇹" },
  { iso: "SE", name: "Sweden", dial: "46", flag: "🇸🇪" },
  { iso: "NO", name: "Norway", dial: "47", flag: "🇳🇴" },
  { iso: "DK", name: "Denmark", dial: "45", flag: "🇩🇰" },
  { iso: "FI", name: "Finland", dial: "358", flag: "🇫🇮" },
  { iso: "PL", name: "Poland", dial: "48", flag: "🇵🇱" },
  { iso: "CZ", name: "Czechia", dial: "420", flag: "🇨🇿" },
  { iso: "RO", name: "Romania", dial: "40", flag: "🇷🇴" },
  { iso: "GR", name: "Greece", dial: "30", flag: "🇬🇷" },
  { iso: "CA", name: "Canada", dial: "1", flag: "🇨🇦" },
  { iso: "MX", name: "Mexico", dial: "52", flag: "🇲🇽" },
  { iso: "BR", name: "Brazil", dial: "55", flag: "🇧🇷" },
  { iso: "AR", name: "Argentina", dial: "54", flag: "🇦🇷" },
  { iso: "CL", name: "Chile", dial: "56", flag: "🇨🇱" },
  { iso: "CO", name: "Colombia", dial: "57", flag: "🇨🇴" },
  { iso: "AU", name: "Australia", dial: "61", flag: "🇦🇺" },
  { iso: "NZ", name: "New Zealand", dial: "64", flag: "🇳🇿" },
  { iso: "JP", name: "Japan", dial: "81", flag: "🇯🇵" },
  { iso: "KR", name: "South Korea", dial: "82", flag: "🇰🇷" },
  { iso: "CN", name: "China", dial: "86", flag: "🇨🇳" },
  { iso: "HK", name: "Hong Kong", dial: "852", flag: "🇭🇰" },
  { iso: "SG", name: "Singapore", dial: "65", flag: "🇸🇬" },
  { iso: "MY", name: "Malaysia", dial: "60", flag: "🇲🇾" },
  { iso: "ID", name: "Indonesia", dial: "62", flag: "🇮🇩" },
  { iso: "PH", name: "Philippines", dial: "63", flag: "🇵🇭" },
  { iso: "TH", name: "Thailand", dial: "66", flag: "🇹🇭" },
  { iso: "VN", name: "Vietnam", dial: "84", flag: "🇻🇳" },
  { iso: "AE", name: "United Arab Emirates", dial: "971", flag: "🇦🇪" },
  { iso: "SA", name: "Saudi Arabia", dial: "966", flag: "🇸🇦" },
  { iso: "IL", name: "Israel", dial: "972", flag: "🇮🇱" },
  { iso: "TR", name: "Turkey", dial: "90", flag: "🇹🇷" },
  { iso: "ZA", name: "South Africa", dial: "27", flag: "🇿🇦" },
  { iso: "NG", name: "Nigeria", dial: "234", flag: "🇳🇬" },
  { iso: "KE", name: "Kenya", dial: "254", flag: "🇰🇪" },
  { iso: "EG", name: "Egypt", dial: "20", flag: "🇪🇬" },
  { iso: "PK", name: "Pakistan", dial: "92", flag: "🇵🇰" },
  { iso: "BD", name: "Bangladesh", dial: "880", flag: "🇧🇩" },
  { iso: "LK", name: "Sri Lanka", dial: "94", flag: "🇱🇰" },
  { iso: "UA", name: "Ukraine", dial: "380", flag: "🇺🇦" },
  { iso: "RU", name: "Russia", dial: "7", flag: "🇷🇺" },
];

export const DEFAULT_COUNTRY = COUNTRIES.find((c) => c.iso === "IN") ?? COUNTRIES[0];

/**
 * Assemble an E.164 number from a country dial code and a locally-typed number.
 * Strips spaces, dashes, parentheses, and a leading national "0" trunk prefix.
 * Returns null when the result isn't a plausible E.164 string (7–15 digits).
 */
export function toE164(dial: string, national: string): string | null {
  const digits = national.replace(/[^\d]/g, "").replace(/^0+/, "");
  if (!digits) return null;
  const e164 = `+${dial}${digits}`;
  // E.164: leading "+", up to 15 digits total (country code included).
  if (!/^\+\d{7,15}$/.test(e164)) return null;
  return e164;
}
