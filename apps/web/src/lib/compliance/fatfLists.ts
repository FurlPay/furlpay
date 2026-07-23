import type { RiskLevel } from './providers/types';

/**
 * FATF lists updated as of June 19, 2026.
 */
export const FATF_UPDATED_AT = '2026-06-19';

/**
 * High-Risk Jurisdictions subject to a Call for Action (Black List)
 */
export const BLACK_LIST = new Set([
  'KP', // Democratic People's Republic of Korea
  'IR', // Iran
  'MM'  // Myanmar
]);

/**
 * Jurisdictions under Increased Monitoring (Grey List)
 */
export const GREY_LIST = new Set([
  'AO', 'BO', 'BA', 'BG', 'CM', 'CI', 'CD', 'HT', 'IQ', 'KE', 
  'KW', 'LA', 'LB', 'MC', 'NP', 'PG', 'SS', 'SY', 'VE', 'VN', 
  'VG', 'YE'
]);

/**
 * Combined set of Black and Grey list countries for easy lookup
 */
export const HIGH_RISK_COUNTRIES = new Set([...BLACK_LIST, ...GREY_LIST]);

export type FATFStatus = 'black' | 'grey' | 'clear';

/**
 * Retrieves the FATF status for a given ISO alpha-2 country code.
 * @param countryCode - The ISO alpha-2 code of the country (e.g., 'US', 'KP')
 * @returns The FATF status ('black', 'grey', or 'clear')
 */
export function getCountryFATFStatus(countryCode: string): FATFStatus {
  const code = countryCode.toUpperCase();
  if (BLACK_LIST.has(code)) return 'black';
  if (GREY_LIST.has(code)) return 'grey';
  return 'clear';
}

/**
 * Determines the general risk level for a country based on its FATF status.
 * @param countryCode - The ISO alpha-2 code of the country
 * @returns 'critical' for black-listed, 'high' for grey-listed, 'low' otherwise
 */
export function getCountryRiskLevel(countryCode: string): RiskLevel {
  const status = getCountryFATFStatus(countryCode);
  switch (status) {
    case 'black':
      return 'critical';
    case 'grey':
      return 'high';
    default:
      return 'low';
  }
}
