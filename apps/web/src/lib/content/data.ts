import type { Report, Webinar } from "./types";

// ---------------------------------------------------------------------------
// The content.
//
// ── EVERY RECORD BELOW IS A DRAFT, ON PURPOSE ──────────────────────────────
//
// FurlPay has not published a webinar or a research report. There is no
// recorded session, no research team output, no PDF, and no measured statistic
// to report. So there is no published content here, and the public pages render
// their empty states.
//
// The two records are DRAFT FIXTURES. They exist so the listing grid, the
// detail route, the filter, the speaker card, the key-finding list and the
// download gate can all be exercised by tests against realistic shapes. They
// are invisible to the site: `publishedReports()` / `publishedWebinars()`
// filter on status, and every public page calls only those.
//
// The fixtures deliberately describe themselves as fixtures. They do not name
// a real person, quote a number nobody measured, or claim a finding. Writing a
// plausible-looking "Stablecoin Payments 2026" with invented percentages would
// put fabricated research on a page headed FURLPAY RESEARCH — which is the one
// thing a research portal must never do, and is far worse than an empty state.
//
// ── TO PUBLISH ─────────────────────────────────────────────────────────────
//
//   1. Replace a fixture (or add a record) with real content.
//   2. Move it through draft → review → approved, then set `status:
//      "published"` (or "scheduled" with a future publishedAt). The status
//      change is the editorial approval, and it lands as a reviewed commit.
//   3. Add the cover/thumbnail under public/content/ and set its real pixel
//      dimensions.
//   4. For a gated PDF: upload it to the PRIVATE research bucket and set
//      `privatePdf` (objectKey, bytes, sha256, version). Never put a gated PDF
//      in public/ — anything there is downloadable by anyone with the URL.
//      See docs/research/RESEARCH_PLATFORM.md.
//
// Nothing else changes: the listing, detail route, sitemap, SEO and lead
// capture all read from here.
// ---------------------------------------------------------------------------

export const WEBINARS: Webinar[] = [
  {
    slug: "example-draft-webinar",
    status: "draft", // ← never rendered publicly
    sessionStatus: "upcoming",
    title: "Example draft webinar (not published)",
    description:
      "A fixture used to exercise the webinar listing, detail page and registration form. It is not a real FurlPay session and is not visible on the site.",
    category: "Stablecoins",
    tags: ["fixture"],
    startsAt: "2026-12-01T15:00:00+00:00",
    duration: "45 min",
    speakers: [
      {
        id: "furlpay-team",
        name: "FurlPay team",
        title: "Placeholder speaker",
        company: "FurlPay",
        bio: "Replace with a real speaker before publishing.",
      },
    ],
    topics: ["Placeholder topic"],
    agenda: [{ time: "00:00", item: "Placeholder agenda item" }],
    relatedReports: ["example-draft-report"],
  },
];

export const REPORTS: Report[] = [
  // ── FurlPay Global Stablecoin Report 2026 ──────────────────────────────
  //
  // Every figure, label and reference below is transcribed from the PDF
  // (87-page edition, data to 2 October 2026; public file sha256 1597d054…401d, 16,353,216 bytes). Evidence labels are the
  // report's own (its page 03 grading; page 49 layer table). Sources carry
  // the titles and dates the report gives — it lists no URLs, so none are
  // added here.
  //
  // STATUS: published (founder decision, 2026-10-03), matching production.
  // The report marks FurlPay's own capabilities "To be confirmed"; the
  // disclaimer below says so on the page.
  {
    slug: "global-stablecoin-report-2026",
    status: "published",
    title: "FurlPay Global Stablecoin Report 2026",
    subtitle: "Stablecoins for a global economy: market data, 23 market profiles, networks, regulation and outlook",
    description:
      "Eighty-seven pages on where stablecoins and digital accounts move money. Supply, issuers, USDC and USDT, card-network settlement, cross-border flows, 23 market profiles, regulation, market structure and risk, fiat rails and licences, and the digital banks that issue IBANs, with every major figure labelled by source type.",
    category: "Stablecoins",
    tags: ["USDC", "USDT", "GENIUS Act", "cross-border", "Visa", "Mastercard", "x402", "Arc", "Singapore", "India", "Brazil"],
    publishedAt: "2026-10-02",
    authors: ["FurlPay Research"],
    pageCount: 87,
    desk: "stablecoin-markets",
    cadence: "annual",
    reportingPeriod: "January 2025 – 2 October 2026",
    // The 87-page PDF states no version number, so none is invented here.
    // Public, as served in production since 2026-10-03 (founder decision):
    // the file lives under /public and needs no storage or email gate.
    pdfPath: "/reports/global-stablecoin-report-2026.pdf",
    gated: false,
    featured: true,
    executiveSummary:
      "The thesis under test, “USDC is becoming an important settlement layer for global payments”, is supported in specific, bounded places: card-network settlement, crypto-linked card spend, institutional mint and redeem, and agent micropayments. It is not yet true for mass consumer or emerging-market retail flows. Verdict: true for institutional and network settlement; partly true for card-funded consumer spend; not yet true for mass remittances and emerging-market retail, where USDT dominates.",
    metrics: [
      { label: "Stablecoin supply", value: "$300.9B", context: "1 Oct 2026; 195 assets, 152 issuers, 47 chains. Peak $322.4B on 17 May 2026.", evidence: "independent", refs: [56, 5] },
      { label: "USDC in circulation", value: "$74.6B", context: "21 Sep 2026, Circle weekly data; reserves $74.8B.", evidence: "primary", refs: [54] },
      { label: "USDT in circulation", value: "$184.6B", context: "30 Jun 2026 attestation; >60% market share.", evidence: "company-claim", refs: [66] },
      { label: "USDC on-chain volume", value: "$14.8T", context: "Q2 2026, one quarter, +151% YoY. Layer A: transfers, not payments.", evidence: "primary", refs: [1] },
      { label: "Real stablecoin payments", value: "$390B", context: "2025, all stablecoins; ~0.02% of global payments.", evidence: "estimate", refs: [8] },
      { label: "Cross-border stablecoin flows", value: "$220.3B", context: "Jul 2025–Jun 2026, +77.5% YoY; a conservative lower bound.", evidence: "independent", refs: [65] },
      { label: "Visa settlement run rate", value: "$20B", context: "Sep 2026; >15x YoY; 160+ stablecoin card programs.", evidence: "company-claim", refs: [12] },
      { label: "Crypto-card spend per month", value: "$759M", context: "Jul 2026, on-chain observed; USDC funds 58%.", evidence: "independent", refs: [32] },
      { label: "GENIUS Act effective", value: "18 Jan 2027", context: "Latest date; Treasury's first interim final rule 30 Sep 2026.", evidence: "law", refs: [19, 59] },
    ],
    keyFindings: [
      { title: "Supply has plateaued; activity has not.", detail: "Total supply sits near $301B (1 Oct), about 7% below the 17 May peak of $322.4B, while USDC on-chain volume rose 151% YoY to $14.8T in Q2.", refs: [56, 5, 1] },
      { title: "Stablecoins were the bear market's anchor.", detail: "Chainalysis finds crypto market cap fell ~50%, yet on-chain economic activity slipped only 1.6% to $9.4T; stablecoin balances held at $98–109B.", refs: [65] },
      { title: "Cross-border usage is the growth engine.", detail: "Stablecoins crossing borders rose 77.5% to $220.3B; monthly flows doubled from $11B (Jan 2025) to $24B (Jun 2026).", refs: [65] },
      { title: "“Payments” are still ~1% of volume.", detail: "McKinsey/Artemis estimate $390B of real payments in 2025, 58% of it B2B ($226B).", refs: [8] },
      { title: "APAC leads payments, but it is a USDT market.", detail: "51.2% of identified payment volume; USDT holds 91% of it, down from 98% in Jan 2025.", refs: [7] },
      { title: "USDC won Q3 on net growth.", detail: "Circle added $915M of supply in Q3 2026, more than any issuer; Tether contracted by $207.7M.", refs: [56] },
      { title: "Card networks settle in stablecoins in production.", detail: "Visa's run rate went $3.5B → $7B → $20B (Nov 2025 → Sep 2026); Mastercard settles in six stablecoins.", refs: [10, 11, 12, 14] },
      { title: "USDC leads where compliance meets card rails.", detail: "USDC funds 58% of on-chain-observed crypto-card spend (USDT 26%).", refs: [32] },
      { title: "Incumbents now issue, not just integrate.", detail: "Open USD (OUSD) launched 30 Sep with Visa, Mastercard, Stripe, Coinbase and Shopify as founders, sharing reserve income with distributors.", refs: [63, 64] },
      { title: "Circle owns a chain.", detail: "Arc public mainnet went live 16 Sep 2026 with 11 institutional validators incl. BlackRock, DTCC, Visa and Mastercard.", refs: [67] },
      { title: "US rules: statute yes, market structure no.", detail: "Treasury issued the first binding GENIUS rule on 30 Sep ($10B state/federal line); the CLARITY Act failed cloture 49–50 on 15 Sep.", refs: [59, 68] },
      { title: "Brazil drew a line on 1 Oct.", detail: "Resolution 561 bars eFX providers from settling offshore legs in stablecoins, even as Brazil ranks #1 for adoption.", refs: [62, 65] },
      { title: "India stays closed onshore.", detail: "The RBI told Parliament prohibition remains an option; 3.93 crore KYC'd users hold ~₹20,437 crore in crypto.", refs: [69] },
      { title: "Peer-to-peer went stablecoin.", detail: "Domestic P2P value rose 302.9% to $228.7B; it is now 96% stablecoins.", refs: [65] },
      { title: "Agent payments are live but tiny.", detail: "75.4M x402 transactions worth $24.2M in a 30-day window (~$0.32 each).", refs: [36] },
      { title: "The opportunity is in the plumbing.", detail: "Settlement, payouts, treasury and card programs, where the stablecoin is invisible to the end user, show the strongest real usage." },
    ],
    body: [
      { kind: "heading", text: "Transaction volume is not payment volume" },
      {
        kind: "paragraph",
        text: "Stablecoin data is reported across four layers that differ by one to two orders of magnitude. The report keeps them separate on every page and labels each major figure by source type. Layer D is roughly 1% of Layer A.",
      },
      {
        kind: "table",
        caption: "The four layers of stablecoin activity (report p. 03)",
        columns: ["Layer", "What it counts", "Example figures"],
        rows: [
          ["A · On-chain transfers", "Every token transfer incl. exchange wallet moves, DeFi loops, bots", "$33T raw (2025); USDC $14.8T in Q2'26 [41, 1]"],
          ["B · Adjusted transfers", "Layer A minus bots, wash trading, intra-entity transfers", "$10.8T (2025); $8.82T H1'26 [9]"],
          ["C · Settlement", "Obligations between regulated institutions settled in stablecoins", "Visa $20B run rate; CPN $14.7B [12, 1]"],
          ["D · Economic payments", "Identified end-user payments: B2B, remittance, payroll, cards", "$390B 2025 [8]; ~$400B [16]"],
        ],
      },
      { kind: "heading", text: "The same market, measured from $220B to $37T" },
      {
        kind: "table",
        caption: "Seven volume measures (report p. 08). Periods and methods differ; the figures are not additive.",
        columns: ["Measure", "Period", "Value"],
        rows: [
          ["CoinDesk Research “adjusted”", "H1 2026", "$37.2T"],
          ["Artemis raw volume", "2025", "$33T"],
          ["Visa/Allium adjusted", "2025", "$10.8T"],
          ["Chainalysis crypto economy (all crypto)", "Jul 2025–Jun 2026", "$9.4T"],
          ["Visa/Allium adjusted", "H1 2026", "$8.82T"],
          ["a16z tracker", "Q1 2026", "$4.5T"],
          ["McKinsey/Artemis real payments", "2025", "$390B"],
          ["Chainalysis cross-border stablecoins", "Jul 2025–Jun 2026", "$220.3B"],
        ],
      },
      {
        kind: "callout",
        title: "Why $37.2T is not payments",
        text: "CoinDesk Research does not disclose its adjustment method, and the figure exceeds 2025 raw volume ($33T), so it reads as near-raw. The Visa/Allium method, which strips bots, wash trading and intra-entity transfers, gives $8.82T for the same half-year. McKinsey/Artemis and Stripe's 2025 annual letter (~$400B, ~60% B2B) converge independently on the scale and mix of real payments.",
      },
      { kind: "heading", text: "Verdict on the core thesis" },
      {
        kind: "table",
        columns: ["Segment", "Verdict", "Evidence"],
        rows: [
          ["Network settlement", "True", "Visa, Mastercard, CPN, bank mint/redeem"],
          ["Consumer cards", "Partly", "58% USDC share of card spend"],
          ["EM retail & remittance", "Not yet", "USDT 91% in APAC; 88.7% in Brazil"],
        ],
      },
      { kind: "heading", text: "What the full report covers" },
      {
        kind: "list",
        items: [
          "Part I · Market & issuers: total supply, issuer landscape, real-economy payments, USDC in 2026, Circle reserves and financials, Tether Q2 2026, USDC vs USDT, chains, global payments context.",
          "Part II · Countries: the Chainalysis 2026 index, the cross-border boom, the United States, an India deep dive, Brazil, Latin America, APAC, Singapore · Hong Kong · Japan, Korea · China · Australia, Southeast Asia, Africa, Middle East & Europe, and a 23-market scorecard.",
          "Part III · Networks & use cases: Visa, Mastercard, Open USD, Circle infrastructure and Arc, Stripe · Tempo · Coinbase, banks and settlement assets, stablecoin cards, cross-border economics, merchant · treasury · remittance, AI-agent payments, regulation, and the outlook with a 2026E scenario model.",
        ],
      },
    ],
    methodology:
      "Research window January 2025 – 2 October 2026. Every major figure carries a source label — Primary (issuer, network, regulator, filing), Independent (third-party analytics such as DefiLlama, Allium, Artemis, Chainalysis), Secondary (reputable media reporting a primary figure), Company claim (an operating metric disclosed only by the company), or Estimate/model (analyst estimate or the report's scenario model) — and a status: Verified, Partial, Ambiguous, Outdated or Unverified. Where only secondary coverage of a primary disclosure was reachable, the figure is attributed to the primary party. Commissioned research (CoinDesk Research APAC, commissioned by Ripple) is flagged. 2030 values are deliberately not projected: no primary source publishes a payment-volume forecast. Sources accessed September–October 2026.",
    disclaimer:
      "For information only; not investment, legal or tax advice. Regulatory descriptions summarise public sources. Company-reported metrics are labelled and have not been independently audited. FurlPay capabilities are shown as To be confirmed pending product documentation.",
    sources: [
      { ref: 1, label: "Circle Q2 2026 results, 5 Aug 2026" },
      { ref: 5, label: "Reap, Stablecoin Statistics 2026 (DefiLlama data), Aug 2026" },
      { ref: 7, label: "CoinDesk Research, Stablecoin Landscape: Asia Pacific, 15 Sep 2026 (Ripple-commissioned)" },
      { ref: 8, label: "McKinsey, Stablecoins in payments, 18 Feb 2026" },
      { ref: 9, label: "Spark (Visa/Allium adjusted data)" },
      { ref: 10, label: "Visa US stablecoin settlement, 16 Dec 2025" },
      { ref: 11, label: "Visa IR, 29 Apr 2026" },
      { ref: 12, label: "Stablecoin Insider, Visa $20B run rate, Sep 2026" },
      { ref: 14, label: "Mastercard stablecoin settlement, Jun 2026" },
      { ref: 16, label: "CoinDesk, Stripe annual letter, 24 Feb 2026" },
      { ref: 19, label: "US Treasury GENIUS proposal, 17 Aug 2026" },
      { ref: 32, label: "a16z crypto, crypto cards and stablecoin spend, Aug 2026" },
      { ref: 36, label: "Forkast, x402 Foundation, 30 Jul 2026" },
      { ref: 41, label: "Forbes, $33T volume, 5 Mar 2026" },
      { ref: 54, label: "PA News / TokenPost, USDC +$300M week to 21 Sep, 25 Sep 2026" },
      { ref: 56, label: "RWA Foundation via U.Today, 2 Oct 2026" },
      { ref: 59, label: "Treasury GENIUS interim final rule via Yahoo Finance, 1 Oct 2026" },
      { ref: 62, label: "CoinDesk (2 May 2026); Crumpton Global (2 Oct 2026); Forexcrunch; BlockEden — Brazil Res. 561" },
      { ref: 63, label: "Bloomberg, Yahoo Finance, Blockhead, Benzinga: OUSD, 30 Sep–1 Oct 2026" },
      { ref: 64, label: "PYMNTS, OUSD economics & SoFiUSD, 30 Sep 2026" },
      { ref: 65, label: "Chainalysis, 2026 Global Crypto Adoption Index, 23 Sep 2026" },
      { ref: 66, label: "Tether Q2 2026 attestation via Cointelegraph, crypto.news, Stablecoin Insider, Bitcoin.com" },
      { ref: 67, label: "Circle pressroom; Decrypt; Cryptopolitan; CoinReporter: Arc mainnet, 16–18 Sep 2026" },
      { ref: 68, label: "CNBC, CoinDesk, AMINA: CLARITY Act vote, 15 Sep 2026" },
      { ref: 69, label: "CryptoDaily / Economic Times: RBI submission, Jul 2026" },
    ],
  },
  {
    slug: "example-draft-report",
    status: "draft", // ← never rendered publicly
    title: "Example draft report (not published)",
    subtitle: "A fixture, not FurlPay research",
    description:
      "A fixture used to exercise the report listing, detail layout, key-finding list and download gate. It contains no research and is not visible on the site.",
    category: "Stablecoins",
    tags: ["fixture"],
    publishedAt: "2026-09-27",
    authors: ["FurlPay"],
    readingTime: "1 min",
    // No pdfPath: nothing to download, so the UI offers "Read online".
    gated: true,
    executiveSummary:
      "This record exists to validate the report layout. Replace it with real research before setting status to published.",
    keyFindings: [
      {
        title: "Placeholder finding",
        detail:
          "Key findings are data-driven and rendered from this array. No finding here is a FurlPay research conclusion.",
      },
    ],
    body: [
      { kind: "heading", text: "Placeholder section" },
      {
        kind: "paragraph",
        text: "Report bodies are structured blocks rather than an HTML string, so headings, lists, tables, quotes and callouts each render through a reviewed component.",
      },
      { kind: "list", items: ["Structured", "Typed", "Reviewable"] },
    ],
    methodology:
      "Replace with a real methodology statement. A research report without one is an opinion piece.",
    relatedWebinars: ["example-draft-webinar"],
  },
];
