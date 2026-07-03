import type { Block } from "@/lib/blog/posts";
import type { InsightCategoryId } from "./categories";

// FurlPay Research articles — structured blocks (same authoring model as the
// blog) plus insight-specific block types rendered by InsightBody.

export interface EarningsRow {
  metric: string;
  actual: string;
  estimate: string;
  surprise?: string;
  beat?: boolean | null;
}
export interface SectorPerf {
  sector: string;
  changePct: number;
}

export type Signal = "bullish" | "bearish" | "neutral";

export type InsightBlock =
  | Block
  | { type: "earnings-table"; title?: string; rows: EarningsRow[] }
  | { type: "stock-card"; symbol: string; signal: Signal; note: string }
  | { type: "price-target"; symbol: string; current: number; target: number; analyst: string }
  | { type: "sector-heatmap"; title?: string; sectors: SectorPerf[] };

export interface InsightArticle {
  slug: string;
  title: string;
  excerpt: string;
  category: InsightCategoryId;
  date: string; // ISO
  readMins: number;
  author: string;
  featured?: boolean;
  tickers: string[];
  signal?: Signal;
  body: InsightBlock[];
}

export const INSIGHTS: InsightArticle[] = [
  // 1 ------------------------------------------------------------------
  {
    slug: "micron-q3-fy2026-record-earnings",
    title: "Micron Q3 FY2026: Record Revenue, Record Margins — Why Memory Is the New Oil",
    excerpt:
      "Micron just printed the biggest quarter in memory-industry history: $41.46B revenue, $25.11 EPS and 84.9% gross margins. HBM supply is sold out into 2027 — here's what it means for the whole AI complex.",
    category: "earnings",
    date: "2026-07-02",
    readMins: 7,
    author: "FurlPay Research",
    featured: true,
    tickers: ["MU", "NVDA", "AVGO", "SMCI", "WDC"],
    signal: "bullish",
    body: [
      {
        type: "p",
        text: `For two decades, memory was the commodity corner of semiconductors — brutal cycles, thin margins, price-takers. Micron's fiscal Q3 2026 print ends that framing for good. Revenue of $41.46 billion and EPS of $25.11 — up 346% year over year — landed on gross margins of 84.9%, numbers that look more like enterprise software than DRAM. High-bandwidth memory (HBM) for AI accelerators did this: every HBM4 wafer Micron can cut is pre-sold, with supply effectively booked out into 2027.`,
      },
      {
        type: "earnings-table",
        title: "Micron fiscal Q3 2026 vs. consensus",
        rows: [
          { metric: "Revenue", actual: "$41.46B", estimate: "$33.9B", surprise: "+22.3%", beat: true },
          { metric: "EPS (diluted)", actual: "$25.11", estimate: "$18.40", surprise: "+36.5%", beat: true },
          { metric: "Gross margin", actual: "84.9%", estimate: "71.2%", surprise: "+13.7pp", beat: true },
          { metric: "HBM revenue mix", actual: "~58%", estimate: "~45%", surprise: "+13pp", beat: true },
          { metric: "Q4 revenue guide", actual: "$46–48B", estimate: "$38.1B", surprise: "raised", beat: true },
        ],
      },
      { type: "h2", text: "Why memory became the bottleneck" },
      {
        type: "p",
        text: `Every generation of AI accelerator is increasingly memory-bound: model weights, KV caches and context windows all scale faster than compute. NVIDIA's and Broadcom's 2026 accelerator lineups attach 2–3× more HBM per package than their 2024 parts. With only three HBM suppliers on earth and yields still hard, pricing power flipped to the memory makers — the "new oil" isn't a metaphor about importance, it's about who sets the price at the margin.`,
      },
      {
        type: "ul",
        items: [
          `Sold out into 2027 — management confirmed HBM4 capacity is fully allocated, with long-term agreements covering >80% of next year's output.`,
          `Margins are structural, not cyclical — HBM is co-designed with each accelerator, making it sticky, qualified, multi-year revenue.`,
          `Capex discipline held — Micron raised capex only modestly, prioritising yield over wafer starts, which protects pricing.`,
        ],
      },
      { type: "stock-card", symbol: "MU", signal: "bullish", note: "Record quarter, sold-out HBM into 2027, guidance raised ~25% above street. The structural-margin thesis is intact." },
      { type: "price-target", symbol: "MU", current: 975, target: 1180, analyst: "FurlPay Research model" },
      { type: "h2", text: "Read-throughs for the AI complex" },
      {
        type: "p",
        text: `A sold-out memory supply chain is bullish for accelerator vendors' pricing (NVDA, AVGO) but a real constraint on unit growth into 2027 — watch for that tension in NVIDIA's August print. Server integrators (SMCI, DELL) inherit longer lead times, and conventional storage (WDC, STX) is quietly benefiting as HBM crowds out NAND/DRAM capacity. The bottleneck has moved: compute is abundant, packaged memory is not.`,
      },
      {
        type: "quote",
        text: `The scarce resource of the AI buildout is no longer FLOPs. It's qualified, packaged, high-bandwidth memory — and there are only three companies on earth that make it.`,
      },
    ],
  },
  // 2 ------------------------------------------------------------------
  {
    slug: "q2-2026-earnings-season-preview-big-tech",
    title: "Q2 2026 Earnings Season Preview: Big Tech Reports — What to Watch",
    excerpt:
      "Banks kick off July 14–15, then the five hyperscalers report in an eight-day window: Alphabet Jul 22, Microsoft & Meta Jul 29, Apple & Amazon Jul 30. S&P 500 earnings are tracking +22% YoY — the strongest since 2022.",
    category: "earnings",
    date: "2026-07-03",
    readMins: 6,
    author: "FurlPay Research",
    featured: true,
    tickers: ["GOOGL", "MSFT", "META", "AAPL", "AMZN", "JPM", "GS"],
    signal: "neutral",
    body: [
      {
        type: "p",
        text: `Q2 2026 earnings season opens with the money-center banks on July 14–15 (JPMorgan, Goldman, Citi, Wells) and crescendos with Big Tech in the last week of July. Consensus has S&P 500 earnings growing roughly 22% year over year on ~12.1% revenue growth — the strongest combination since 2022 — driven overwhelmingly by AI-infrastructure capex flowing through to semis, power and cloud.`,
      },
      {
        type: "earnings-table",
        title: "Key report dates — Q2 2026",
        rows: [
          { metric: "JPMorgan, Wells Fargo, Citi", actual: "Jul 14", estimate: "Banks set the macro tone", beat: null },
          { metric: "Goldman Sachs, Morgan Stanley, BofA", actual: "Jul 15", estimate: "Trading & IB revenue watch", beat: null },
          { metric: "Alphabet, Tesla", actual: "Jul 22", estimate: "First hyperscaler capex data point", beat: null },
          { metric: "Microsoft, Meta", actual: "Jul 29", estimate: "Azure AI + ad-market health", beat: null },
          { metric: "Apple, Amazon", actual: "Jul 30", estimate: "Consumer + AWS margins", beat: null },
        ],
      },
      { type: "h2", text: "The three questions that decide the quarter" },
      {
        type: "ul",
        items: [
          `Is AI capex still accelerating? Combined hyperscaler capex guidance is the single most market-moving number of the season — any deceleration hits the entire semis complex.`,
          `Are AI revenues showing up? Investors want inference revenue and copilot attach rates, not just infrastructure spend. Microsoft's AI run-rate disclosure and Meta's ad-pricing gains are the tells.`,
          `Do margins hold? With 22% earnings growth priced in, gross-margin misses get punished. Watch energy and depreciation lines as datacenter fleets age.`,
        ],
      },
      { type: "stock-card", symbol: "GOOGL", signal: "neutral", note: "First mover on Jul 22 — its capex guide and Gemini monetisation commentary set expectations for everyone reporting after it." },
      { type: "stock-card", symbol: "MSFT", signal: "bullish", note: "Azure AI services remain the cleanest AI-revenue disclosure in the group; copilot seat growth is the number to watch." },
      {
        type: "p",
        text: `Positioning note: with indices at highs and expectations elevated, beats are likely to be sold and any guide-down punished hard. Staggered exposure — or simply holding through the window — beats trying to trade each print. FurlPay users can track every name on its market page, where reports will surface as they land.`,
      },
    ],
  },
  // 3 ------------------------------------------------------------------
  {
    slug: "five-ai-infrastructure-stocks-2t-buildout",
    title: "5 AI Infrastructure Stocks Powering the $2T Buildout",
    excerpt:
      "The AI datacenter buildout is now a ~$2 trillion capital cycle spanning chips, memory, networking, power and cooling. These five names sit at the chokepoints.",
    category: "stock-analysis",
    date: "2026-07-01",
    readMins: 8,
    author: "FurlPay Research",
    tickers: ["NVDA", "MU", "AVGO", "TSM", "AMD", "ANET", "ETN"],
    signal: "bullish",
    body: [
      {
        type: "p",
        text: `Add up announced hyperscaler capex, sovereign AI programs and enterprise buildouts through 2028 and you get a number around $2 trillion. Capital cycles that large don't reward everything equally — they reward chokepoints: places where supply can't respond quickly to demand. Here are the five we own in the FurlPay Research model portfolio, and why.`,
      },
      { type: "stock-card", symbol: "NVDA", signal: "bullish", note: "Still the systems company, not a chip company — NVLink fabric + CUDA keep switching costs brutal. Rubin cycle ramps into H2." },
      { type: "stock-card", symbol: "MU", signal: "bullish", note: "HBM sold out into 2027 at software-like margins (see our Q3 review). The cheapest way to own the memory bottleneck." },
      { type: "stock-card", symbol: "AVGO", signal: "bullish", note: "Every hyperscaler designing custom silicon runs it through Broadcom — XPU + networking gives two ways to win." },
      { type: "stock-card", symbol: "TSM", signal: "bullish", note: "The only foundry that matters at the leading edge. CoWoS advanced-packaging capacity is the industry's real unit constraint." },
      { type: "stock-card", symbol: "ANET", signal: "bullish", note: "AI clusters are networks first — 800G Ethernet backlogs and hyperscaler share gains compound quietly." },
      { type: "h2", text: "The power problem is the next trade" },
      {
        type: "p",
        text: `Every incremental gigawatt of AI datacenter needs grid interconnects, transformers, switchgear and liquid cooling — markets where lead times run two to four years. Eaton (ETN) and the utilities with nuclear-adjacent capacity (NEE, and the URA uranium complex) are the second-derivative plays most portfolios still underweight. When memory and packaging bottlenecks clear, power becomes the binding constraint.`,
      },
      {
        type: "quote",
        text: `In a gold rush, sell shovels. In a compute rush, own whatever the shovel factory can't get enough of.`,
      },
      {
        type: "p",
        text: `Risk to the thesis: a visible deceleration in hyperscaler capex guidance this earnings season (see our Q2 preview) would compress every multiple in this list simultaneously. Size accordingly — concentration in one theme is a feature until it isn't.`,
      },
    ],
  },
  // 4 ------------------------------------------------------------------
  {
    slug: "semiconductor-supercycle-structural-longs",
    title: "The Semiconductor Supercycle: Why MU, AVGO and QCOM Are Structural Longs",
    excerpt:
      "This isn't the 2021 chip shortage rerun. Memory pricing power, custom-silicon backlogs and edge-AI attach rates have changed the sector's earnings power for a decade.",
    category: "sector-watch",
    date: "2026-06-28",
    readMins: 7,
    author: "FurlPay Research",
    tickers: ["MU", "AVGO", "QCOM", "INTC", "AMD", "SMH"],
    signal: "bullish",
    body: [
      {
        type: "p",
        text: `Semiconductor cycles used to be inventory cycles: over-order, glut, crash, repeat. The 2026 cycle is different in kind — demand is programmatic (multi-year AI capex plans), supply is consolidated (three memory makers, one leading-edge foundry), and product is co-designed with customers years ahead. That combination converts what used to be commodity cyclicality into contracted, visible earnings.`,
      },
      {
        type: "sector-heatmap",
        title: "Semis vs. the market — trailing 12 months",
        sectors: [
          { sector: "Memory (MU)", changePct: 96 },
          { sector: "Custom silicon (AVGO)", changePct: 44 },
          { sector: "GPU (NVDA)", changePct: 38 },
          { sector: "Edge/mobile (QCOM)", changePct: 21 },
          { sector: "Semis index (SMH)", changePct: 33 },
          { sector: "S&P 500", changePct: 14 },
          { sector: "Foundry (TSM)", changePct: 41 },
          { sector: "x86 (INTC)", changePct: -8 },
        ],
      },
      { type: "h2", text: "Three structural longs" },
      {
        type: "ul",
        items: [
          `Micron (MU) — the HBM oligopoly member trading at the biggest discount to its new margin structure; the market still prices a cycle that no longer exists.`,
          `Broadcom (AVGO) — custom XPU programs for at least five hyperscalers plus the Ethernet networking franchise; backlog visibility measured in years.`,
          `Qualcomm (QCOM) — the edge-AI sleeper: on-device inference is becoming a handset, auto and PC attach story, and the market still values it like a maturing modem vendor.`,
        ],
      },
      { type: "price-target", symbol: "QCOM", current: 176, target: 225, analyst: "FurlPay Research model" },
      { type: "h2", text: "What breaks the thesis" },
      {
        type: "p",
        text: `Watch Intel's foundry progress (a credible second leading-edge source would deflate pricing power across the chain), China export-control escalation, and any hyperscaler capex deceleration. None are visible in the data today — but supercycle theses die on the day everyone stops questioning them, so we keep the checklist explicit.`,
      },
    ],
  },
  // 5 ------------------------------------------------------------------
  {
    slug: "sp500-all-time-highs-rally-sustainable",
    title: "S&P 500 at All-Time Highs: Is the Rally Sustainable?",
    excerpt:
      "The index sits at records with earnings growing 22% — but leadership is narrow, valuations are full, and the Fed hasn't cut since March. A framework for staying invested without being complacent.",
    category: "market-outlook",
    date: "2026-06-30",
    readMins: 6,
    author: "FurlPay Research",
    tickers: ["SPY", "QQQ", "VOO", "RSP", "IWM"],
    signal: "neutral",
    body: [
      {
        type: "p",
        text: `The S&P 500 enters July 2026 at all-time highs, up double digits year to date. Bears point to concentration (the top ten names are ~38% of the index), a forward multiple near 23×, and a Fed on hold. Bulls point to the fastest earnings growth since 2022 — around 22% year over year — and the fact that expensive markets with accelerating earnings historically keep working. Both are right; the question is what you own, not whether you're in.`,
      },
      { type: "h2", text: "The case for staying invested" },
      {
        type: "ul",
        items: [
          `Earnings, not multiple expansion, are driving this leg — the index P/E is roughly flat over six months while prices rose with profits.`,
          `Breadth is improving at the margin: equal-weight (RSP) and small caps (IWM) have outperformed the cap-weighted index over the last month.`,
          `Positioning isn't euphoric — money-market assets remain near records, a reservoir that historically feeds pullback-buying.`,
        ],
      },
      { type: "h2", text: "The risks worth respecting" },
      {
        type: "ul",
        items: [
          `Concentration cuts both ways: one bad hyperscaler capex guide moves the whole index (see our Q2 earnings preview).`,
          `The Fed has held since March; a hawkish surprise on sticky services inflation would hit long-duration growth multiples first.`,
          `July 22–30 is the highest-stakes eight-day window of the quarter — five mega-caps report into record expectations.`,
        ],
      },
      {
        type: "quote",
        text: `Time in the market beats timing the market — but what you hold during the time matters more than either.`,
      },
      {
        type: "p",
        text: `Our stance: fully invested, tilted toward equal-weight and quality-factor exposure (RSP, QUAL, SCHD) to sidestep single-name concentration, with the AI-infrastructure sleeve (see our $2T buildout piece) as the growth engine. Neutral on adding at these levels; aggressive on adding into any 5%+ earnings-season drawdown.`,
      },
    ],
  },
  // 6 ------------------------------------------------------------------
  {
    slug: "bitcoin-post-halving-accumulation-phase",
    title: "Bitcoin Post-Halving: On-Chain Metrics Signal Accumulation Phase",
    excerpt:
      "Fifteen months after the 2024 halving, BTC consolidates near $61K while long-term holder supply hits records and exchange balances sit at seven-year lows. The on-chain picture says accumulation, not distribution.",
    category: "crypto-blockchain",
    date: "2026-06-27",
    readMins: 6,
    author: "FurlPay Research",
    tickers: ["BTC", "ETH", "SOL", "IBIT"],
    signal: "bullish",
    body: [
      {
        type: "p",
        text: `Bitcoin has spent the first half of 2026 consolidating in a broad range around $61,000 — frustrating for momentum traders, but constructive under the surface. The classic post-halving playbook (supply shock → 12–18 month re-rating) has been muted this cycle by ETF-driven flows that front-ran the halving. What matters now is who holds the coins, and the answer is increasingly: people who don't sell.`,
      },
      { type: "h2", text: "The on-chain evidence" },
      {
        type: "ul",
        items: [
          `Long-term holder supply (coins unmoved for 155+ days) is at an all-time high share of circulating supply — the signature of accumulation regimes.`,
          `Exchange balances are at their lowest since 2019 — coins keep migrating to ETFs and self-custody, shrinking liquid sell-side supply.`,
          `Realized-price cohorts show the average 2026 buyer is barely in profit — historically the setup for low-volatility grinds higher, not blow-off tops.`,
          `Miner selling pressure post-halving has normalised; hash rate at records means miner capitulation risk is off the table.`,
        ],
      },
      { type: "stock-card", symbol: "BTC", signal: "bullish", note: "Supply migrating to strong hands while liquid float shrinks. Range-bound price + improving holder base = accumulation." },
      { type: "stock-card", symbol: "ETH", signal: "neutral", note: "Underperformed BTC this cycle; the L2 fee-abstraction debate keeps value accrual murky even as usage grows." },
      { type: "h2", text: "How we'd position" },
      {
        type: "p",
        text: `Core BTC exposure (spot or IBIT in tax-advantaged accounts), a smaller ETH allocation, and SOL for high-beta network growth. In FurlPay, dollar-cost averaging via stablecoin swaps automates the accumulation posture the data supports. The invalidation: a sustained break below the $52K realized-price shelf would signal this regime failed.`,
      },
      {
        type: "quote",
        text: `Bull markets are born in accumulation nobody notices, mature in trends everybody chases, and die in distribution everybody rationalises.`,
      },
    ],
  },
  // 7 ------------------------------------------------------------------
  {
    slug: "dividend-kings-2026",
    title: "Dividend Kings for 2026: Stocks That Pay You While You Sleep",
    excerpt:
      "Fifty-plus years of uninterrupted dividend growth is a survivorship filter money can't buy. Five kings worth owning now, plus the ETF shortcut.",
    category: "stock-analysis",
    date: "2026-06-25",
    readMins: 6,
    author: "FurlPay Research",
    tickers: ["KO", "PG", "JNJ", "PEP", "WMT", "SCHD", "NOBL"],
    signal: "bullish",
    body: [
      {
        type: "p",
        text: `A Dividend King has raised its payout for 50 consecutive years — through Volcker, dot-com, 2008, COVID and the 2022–23 rate shock. That's not a yield screen; it's a business-model stress test with a half-century sample. In a market obsessed with AI beta, the kings are quietly compounding with payout yields of 2.5–4% and zero drama.`,
      },
      { type: "h2", text: "Five kings for 2026" },
      {
        type: "ul",
        items: [
          `Coca-Cola (KO) — 64 straight increases; pricing power that tracks inflation with volumes that don't care about the Fed.`,
          `Procter & Gamble (PG) — 69 increases; the premium-brand portfolio keeps taking price without losing share.`,
          `Johnson & Johnson (JNJ) — 63 increases; post-Kenvue, a purer pharma/medtech grower with a fortress balance sheet.`,
          `PepsiCo (PEP) — 53 increases; snacks + beverages diversification and an underrated international growth lane.`,
          `Walmart (WMT) — 52 increases; the rare king that's also a genuine AI-logistics story, with advertising margin mix on top.`,
        ],
      },
      { type: "stock-card", symbol: "KO", signal: "bullish", note: "The archetype: 64 years of raises, global distribution moat, and a 2.9% yield that grows through every macro regime." },
      { type: "h2", text: "The ETF shortcut" },
      {
        type: "p",
        text: `If single names feel like homework, NOBL (equal-weight Dividend Aristocrats) and SCHD (quality-screened dividend growth) bundle the factor. Reinvested dividends have historically contributed roughly a third of total US equity returns — in FurlPay, dividend income lands in your portfolio automatically and shows up in the Dividends tab with YTD totals.`,
      },
      {
        type: "quote",
        text: `The best dividend stock is the one whose next 25 raises you never have to think about.`,
      },
    ],
  },
  // 8 ------------------------------------------------------------------
  {
    slug: "solana-vs-ethereum-l2s-defi-2026",
    title: "Solana vs. Ethereum L2s: Where Is DeFi Capital Flowing in 2026?",
    excerpt:
      "Solana leads in DEX volume and new-user onboarding; Ethereum's L2s lead in TVL depth and institutional rails. The capital-flow data says the answer isn't either/or.",
    category: "crypto-blockchain",
    date: "2026-06-24",
    readMins: 7,
    author: "FurlPay Research",
    tickers: ["SOL", "ETH", "ARB", "OP", "JUP", "UNI"],
    signal: "neutral",
    body: [
      {
        type: "p",
        text: `The great DeFi migration question of 2026: does activity consolidate on Solana's single fast state machine, or across Ethereum's rollup archipelago? A year of flow data gives an unsatisfying but profitable answer — both, for different jobs. Retail order flow, memecoins and consumer payments have gone to Solana; institutional liquidity, RWAs and blue-chip lending stay on Ethereum and its L2s.`,
      },
      { type: "h2", text: "What the data shows" },
      {
        type: "ul",
        items: [
          `DEX volume: Solana regularly clears 40%+ of global DEX volume on peak days, led by Jupiter — but with higher churn and memecoin mix.`,
          `TVL depth: Ethereum L1 + L2s still hold roughly 55% of DeFi TVL, and >70% of tokenised-treasury (RWA) value — institutions deploy where legal wrappers exist.`,
          `Base is the swing factor: Coinbase's L2 onboards more net-new funded wallets than any chain, and its fee revenue now rivals OP mainnet + Arbitrum combined.`,
          `Stablecoin settlement (FurlPay's own rail data): USDC velocity is highest on Base and Solana — exactly the two chains we settle on.`,
        ],
      },
      { type: "stock-card", symbol: "SOL", signal: "bullish", note: "Wins the consumer/order-flow war: fastest onboarding, dominant DEX share, and the Firedancer client removes the reliability discount." },
      { type: "stock-card", symbol: "ARB", signal: "neutral", note: "Deepest L2 DeFi stack but token value accrual stays contested; a bet on Ethereum's rollup roadmap paying out slowly." },
      { type: "h2", text: "Portfolio construction" },
      {
        type: "p",
        text: `We treat it as a barbell: SOL for consumer-crypto beta, ETH as the institutional settlement reserve asset, with small L2 satellites (ARB, OP) as optionality on rollup fee growth. The scenario that breaks the barbell — a credible Ethereum execution-layer scaling breakthrough that pulls consumer flow back to L1 — is worth monitoring but isn't the 2026 base case.`,
      },
    ],
  },
  // 9 ------------------------------------------------------------------
  {
    slug: "tesla-fy2026-robotaxi-revenue",
    title: "Tesla's FY2026 Robotaxi Revenue: Hype or Inflection?",
    excerpt:
      "Austin and Bay Area robotaxi zones are live and expanding, but robotaxi is still <2% of revenue. The stock prices the 2030 story — the July 22 print will test the 2026 one.",
    category: "stock-analysis",
    date: "2026-06-22",
    readMins: 6,
    author: "FurlPay Research",
    tickers: ["TSLA", "UBER", "GOOGL"],
    signal: "neutral",
    body: [
      {
        type: "p",
        text: `Tesla reports Q2 on July 22 with the widest bull-bear spread of any mega-cap. Bears see an auto company with flat deliveries, price cuts and rising competition from Chinese OEMs. Bulls see an AI robotics company whose robotaxi zones in Austin and the Bay Area are scaling weekly rides at software margins. Both narratives are true — the argument is about which one earns the multiple.`,
      },
      { type: "h2", text: "What we can actually measure" },
      {
        type: "ul",
        items: [
          `Robotaxi is real but small: expanding geofenced zones and rising paid rides, yet still under ~2% of revenue — the inflection is directional, not financial, so far.`,
          `Auto gross margin (ex-credits) is the quarter's swing number — stabilisation above 17% keeps the cash engine funding the AI story.`,
          `Energy storage remains the quiet compounder, growing faster than autos with better margins, and rarely gets airtime on the calls.`,
          `FSD supervised take-rates and the unsupervised-approval timeline are worth more to the model than delivery counts.`,
        ],
      },
      { type: "price-target", symbol: "TSLA", current: 393, target: 420, analyst: "FurlPay Research base case" },
      { type: "h2", text: "Our verdict" },
      {
        type: "p",
        text: `Neutral. The robotaxi inflection is genuine but the revenue inflection is a 2027–28 event, while the 2026 P&L is still an auto company's. We'd rather own the ecosystem winners either way — semis feeding every AV program, and Alphabet's Waymo optionality nobody prices — than pay a robotics multiple for auto cash flows today. For believers, staged entries beat conviction sizing before July 22.`,
      },
    ],
  },
  // 10 -----------------------------------------------------------------
  {
    slug: "robinhood-chain-tokenized-stocks",
    title: "Robinhood Chain Launch: What Tokenized Stocks Mean for Retail Investors",
    excerpt:
      "Robinhood's L2 brings tokenized US equities to Europe with 24/7 settlement, and Coinbase is racing to follow. Tokenization is the first credible rewrite of market plumbing since ETFs.",
    category: "ipo-listings",
    date: "2026-06-20",
    readMins: 6,
    author: "FurlPay Research",
    tickers: ["HOOD", "COIN", "ETH", "ARB"],
    signal: "bullish",
    body: [
      {
        type: "p",
        text: `Robinhood's Arbitrum-based chain now settles tokenized US stocks and ETFs for European users around the clock — no T+1, no market-hours window, fractional by default. Coinbase has its own tokenized-equity ambitions pending SEC clarity. This is the ETF moment of the 2020s: a wrapper change that looks incremental and ends up rewiring distribution.`,
      },
      { type: "h2", text: "Why tokenization matters" },
      {
        type: "ul",
        items: [
          `24/7 markets: earnings drop after hours; tokenized holders react instantly while traditional accounts wait for the open.`,
          `Programmable equity: stocks as collateral in DeFi lending, automated DCA at the contract level, instant settlement against stablecoins.`,
          `Distribution collapse: a wallet is a brokerage — the marginal cost of serving a new market approaches zero, which is exactly Robinhood's European play.`,
          `The risk list is real: oracle integrity, corporate-action handling, and the regulatory question of whether a token is the share or a derivative of it.`,
        ],
      },
      { type: "stock-card", symbol: "HOOD", signal: "bullish", note: "First-mover on a chain it owns — sequencer fees + tokenized-equity spread on top of the retail-flow business." },
      { type: "stock-card", symbol: "COIN", signal: "bullish", note: "The regulated-custody arms dealer of tokenization; wins whichever brokerage's wrapper prevails." },
      {
        type: "p",
        text: `FurlPay's angle: our fractional-equity rail (Alpaca) and stablecoin settlement stack are wrapper-agnostic — when tokenized equities reach regulatory clarity in the EEA, holding AAPL and paying with USDC from one balance sheet is exactly the account architecture we already run.`,
      },
      {
        type: "quote",
        text: `Every generation gets one market-structure rewrite. Boomers got discount brokers, millennials got zero-commission apps — this one belongs to the wallet.`,
      },
    ],
  },
  // 11 -----------------------------------------------------------------
  {
    slug: "fed-holds-july-fomc-portfolio",
    title: "Fed Holds Rates Steady: What the July FOMC Means for Your Portfolio",
    excerpt:
      "The Fed has been on hold since March with the policy rate at 3.25–3.50%. Sticky services inflation vs. a cooling labour market — here's the asset-by-asset playbook for the pause.",
    category: "market-outlook",
    date: "2026-06-18",
    readMins: 5,
    author: "FurlPay Research",
    tickers: ["SPY", "TLT", "GLD", "SCHD"],
    signal: "neutral",
    body: [
      {
        type: "p",
        text: `The July FOMC is set to extend the pause that began in March, holding the funds rate at 3.25–3.50%. The committee is caught between services inflation that refuses to break below 3% and a labour market that's cooling at the edges. Futures price one to two cuts by year-end; the Fed's own dots say one. For portfolios, a long pause is a regime of its own — and it has an asset-by-asset playbook.`,
      },
      { type: "h2", text: "The pause playbook" },
      {
        type: "ul",
        items: [
          `Equities (SPY): pauses have historically been kind to stocks as long as earnings grow — and Q2 is tracking +22%. It's a cut *cycle* that usually signals trouble.`,
          `Duration (TLT): dead money until the cutting cycle is visible; the 10-year around 4.1% is fair, not cheap. We stay short-duration in the bond sleeve.`,
          `Gold (GLD): holding near records despite positive real rates — central-bank buying has decoupled it from the old playbook; keep the 5% ballast.`,
          `Cash & stablecoins: 3%+ risk-free still pays you to wait — FurlPay's USDC earn rail keeps dry powder productive between deployments.`,
          `Dividend equities (SCHD): the sleeper winner if cuts arrive late-year — yield becomes scarce exactly when money-market rates finally fall.`,
        ],
      },
      {
        type: "quote",
        text: `Don't fight the Fed cuts both ways: when they're on hold and profits are growing, the expensive mistake is usually being out, not being in.`,
      },
      {
        type: "p",
        text: `Watch September, not July: the next summary of economic projections lands then, and two soft CPI prints between now and that meeting would move the first cut from "priced" to "promised". Position for the pause, keep optionality for the pivot.`,
      },
    ],
  },
  // 12 -----------------------------------------------------------------
  {
    slug: "energy-sector-oil-majors-vs-clean-energy",
    title: "Energy Sector Deep Dive: Oil Majors vs. Clean Energy ETFs in 2026",
    excerpt:
      "Oil majors are cash machines at $78 Brent; clean energy is finally profitable because AI datacenters will buy every electron. The 2026 answer is owning the megawatt, however it's made.",
    category: "sector-watch",
    date: "2026-06-15",
    readMins: 7,
    author: "FurlPay Research",
    tickers: ["XOM", "CVX", "ICLN", "TAN", "NEE", "URA"],
    signal: "neutral",
    body: [
      {
        type: "p",
        text: `The old energy debate — hydrocarbons vs. renewables — has been dissolved by a bigger force: AI power demand. US electricity consumption is growing again for the first time in two decades, and datacenter operators will sign power-purchase agreements with anyone who can deliver firm megawatts this decade. That reframes both sides of the sector.`,
      },
      {
        type: "sector-heatmap",
        title: "Energy complex — 2026 YTD performance",
        sectors: [
          { sector: "Uranium (URA)", changePct: 28 },
          { sector: "Utilities (NEE)", changePct: 19 },
          { sector: "Solar (TAN)", changePct: 16 },
          { sector: "Clean energy (ICLN)", changePct: 13 },
          { sector: "Oil majors (XOM)", changePct: 7 },
          { sector: "Refiners (VLO)", changePct: 4 },
          { sector: "Oil services (SLB)", changePct: -3 },
        ],
      },
      { type: "h2", text: "The bull case for each side" },
      {
        type: "ul",
        items: [
          `Oil majors (XOM, CVX): at ~$78 Brent they cover dividends and buybacks below $55 breakevens — 4–6% shareholder yields with balance sheets that could buy the entire solar industry.`,
          `Clean energy (ICLN, TAN): the profitability inflection finally arrived — datacenter PPAs pay premium prices for 24/7 carbon-free energy, and rate stabilisation fixed the financing math.`,
          `The bridge trade — uranium and grid (URA, NEE, ETN): nuclear is the only firm, carbon-free, AI-scale answer this decade, which is why hyperscalers keep signing SMR agreements.`,
        ],
      },
      { type: "stock-card", symbol: "XOM", signal: "neutral", note: "A cash-return machine, not a growth story — own it for the yield discipline, size it knowing the terminal-demand debate is unresolved." },
      { type: "stock-card", symbol: "NEE", signal: "bullish", note: "The largest renewables developer wrapped in a regulated utility — the cleanest way to sell electrons to the AI buildout." },
      {
        type: "p",
        text: `Our allocation: barbell the megawatt. Oil-major yield on one end, regulated-renewable growth and uranium on the other, and skip the middle (services, refiners) where neither the cash-return nor the growth story is clean. In FurlPay, the Clean Energy collection tracks the full basket.`,
      },
    ],
  },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function getSortedInsights(): InsightArticle[] {
  return [...INSIGHTS].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getFeaturedInsight(): InsightArticle {
  return INSIGHTS.find((a) => a.featured) ?? getSortedInsights()[0];
}

export function getInsight(slug: string): InsightArticle | undefined {
  return INSIGHTS.find((a) => a.slug === slug);
}

export function insightsByCategory(category: InsightCategoryId): InsightArticle[] {
  return getSortedInsights().filter((a) => a.category === category);
}

export function insightsByTicker(symbol: string): InsightArticle[] {
  const sym = symbol.toUpperCase();
  return getSortedInsights().filter((a) => a.tickers.includes(sym));
}
