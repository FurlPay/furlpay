// Single source of truth for the regional hreflang cluster on a given page.
//
// Every regional variant of a page (US default, /uk, /ae, /jp) must list all of
// its siblings so search engines treat them as one reciprocal cluster. Passing
// the per-region paths here keeps the `languages` map symmetric and avoids the
// drift that crept in when maps were hand-written per file.
export type RegionPaths = {
  us: string; // en-US and x-default both point here (global English default)
  uk?: string;
  ae?: string;
  jp?: string;
};

export function altLanguages(p: RegionPaths): Record<string, string> {
  const langs: Record<string, string> = { "en-US": p.us };
  if (p.uk) langs["en-GB"] = p.uk;
  if (p.ae) langs["en-AE"] = p.ae;
  if (p.jp) langs["en-JP"] = p.jp;
  langs["x-default"] = p.us;
  return langs;
}
