// Natural-language hotel query parser for the travel side panel. Extracted
// from sidepanel/App.tsx so the heuristics are unit-testable — this is the
// only thing standing between "Find me a hotel in Tokyo under $150/night"
// and a structured TRAVEL_SEARCH request.

export interface ParsedTravelQuery {
  city?: string;
  maxNightlyUsd?: number;
  checkIn?: string;
  checkOut?: string;
}

/** Extract { city, maxNightlyUsd, checkIn, checkOut } from natural language,
 *  e.g. "Find me a hotel in Tokyo under $150/night for July 20-23". */
export function parseQuery(text: string): ParsedTravelQuery {
  const city = /(?:in|to|at)\s+([A-Z][A-Za-zÀ-ÿ' -]{2,30}?)(?=\s+(?:under|below|for|from|between|next|on|this)\b|[,.!?]|$)/.exec(
    text
  )?.[1]?.trim();
  const maxNightly = /(?:under|below|max|less than)\s*\$?\s*(\d{2,5})/i.exec(text)?.[1];

  const months = "january|february|march|april|may|june|july|august|september|october|november|december";
  const range = new RegExp(`(${months})\\s+(\\d{1,2})\\s*(?:-|to|–)\\s*(\\d{1,2})`, "i").exec(text);
  let checkIn: string | undefined;
  let checkOut: string | undefined;
  if (range) {
    const year = new Date().getFullYear();
    const monthIndex = range[1].toLowerCase();
    const monthNum = months.split("|").indexOf(monthIndex) + 1;
    const mm = String(monthNum).padStart(2, "0");
    checkIn = `${year}-${mm}-${String(range[2]).padStart(2, "0")}`;
    checkOut = `${year}-${mm}-${String(range[3]).padStart(2, "0")}`;
  }
  return { city, maxNightlyUsd: maxNightly ? Number(maxNightly) : undefined, checkIn, checkOut };
}
