// Published reports that have their own route folder, app/reports/<slug>/.
// /reports/[slug] must not prerender these: its HTML for the same path wins in
// a production build and hides the dedicated page. dedicatedPages.spec.ts keeps
// this list equal to the folders on disk.
export const DEDICATED_REPORT_PAGES: ReadonlySet<string> = new Set(["global-stablecoin-report-2026"]);
