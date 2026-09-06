import type { CategoryId } from "@/lib/blog/categories";

// Blog content lives here as structured blocks (MDX-style authoring without an
// external MDX pipeline). Article pages render these via ArticleBody; the feed
// and category pages read the frontmatter fields.

export type Block =
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "code"; lang: string; code: string }
  | { type: "quote"; text: string }
  | { type: "diagram"; text: string }
  // Comparison/data tables. The first cell of each row renders as a row
  // header; highlightCol tints one column (0-indexed into headers/rows) —
  // used to spotlight the Furlpay column in competitive matrices.
  | { type: "table"; headers: string[]; rows: string[][]; highlightCol?: number };

export type Post = {
  slug: string;
  title: string;
  excerpt: string;
  category: CategoryId;
  date: string; // ISO date, YYYY-MM-DD
  readMins: number;
  author: string;
  featured?: boolean;
  /**
   * SEO <title>, when the human headline is the wrong length or shape for a
   * search result. A headline can afford a rhetorical structure that a SERP
   * entry cannot: Google truncates near 60 characters and rewards the primary
   * term appearing early. Falls back to `title` when absent, so existing posts
   * are unaffected.
   */
  seoTitle?: string;
  /**
   * ISO date of the last MATERIAL revision, emitted as schema.org dateModified.
   *
   * Set it only when facts changed. Bumping it for a typo teaches Google that
   * the signal is noise, and re-dating an old article to look fresh is the
   * behaviour the freshness signal exists to catch.
   */
  updated?: string;
  cover?: string; // real photo URL (hotlinked Unsplash CDN); CSS art fallback when absent
  body: Block[];
};

export const POSTS: Post[] = [
  // Solana 2026 infrastructure. Written 2026-09-07.
  //
  // THE LIVE-VS-SCHEDULED TABLE IS THE POINT OF THIS PIECE. Most coverage of
  // this roadmap reports shipped and announced upgrades in the same voice.
  // Alpenglow especially: the codebase shipped in Agave 4.2, which is not the
  // same as the algorithm being active, and it is NOT active as of writing.
  //
  // VERIFIED BEFORE PUBLICATION:
  //   - SIMD-0286: 60M -> 100M CUs, +66%, mainnet 29 Jul 2026 at epoch 1009,
  //     authored by Jito Labs. Max WRITABLE ACCOUNT units unchanged at 12M —
  //     a detail dropped from most summaries and load-bearing for anyone with
  //     a hot account. Justification: 11.2% of blocks used >=56M CUs.
  //   - SIMD-0525: 350ms live epoch 1020 (21 Aug 2026), the first slot-time
  //     reduction since genesis; 300ms live epoch 1024 (~28 Aug 2026).
  //     250ms/200ms scheduled, gated on skip-rate safety metrics.
  //   - Alpenglow/Votor: ~150ms finality target vs ~12.8s TowerBFT. 80%
  //     first-round / 60% fallback. Fault tolerance 33% -> 40%, "20+20".
  //     Agave 4.2 shipped the code; activation withheld pending hardening and
  //     a 50,000 SOL bug bounty through August. Agave 4.3 schedule (published
  //     12 Aug) targets 28 Sep 2026; earlier Foundation guidance said Oct 2026.
  //     BOTH ARE STATED — sources genuinely disagree.
  //   - Transaction size 1,232 -> 4,096 bytes via the v1 format.
  //
  // CORRECTED FROM THE SOURCE BRIEF: it gave the pre-SIMD-0286 limit as 48M.
  // It was 60M. The +66% figure only reconciles with 60M, and publishing 48M
  // would have been an arithmetic error anyone checking would catch.
  //
  // DELIBERATELY OMITTED: a specific "votes consume 30-40% of block space"
  // figure, and a "~81,000 protocol TPS" ceiling. Neither could be sourced;
  // the qualitative direction is stated instead.
  {
    slug: "solana-infrastructure-2026",
    title: "Solana Is Being Rebuilt Around Latency, Not Throughput",
    seoTitle:
      "Solana 2026: 300ms Slots, 100M CU Blocks and Alpenglow Finality Explained",
    excerpt:
      "In August 2026 Solana cut its slot time below 400ms for the first time since genesis, and block capacity had already risen 66% to 100M compute units. But finality still takes 12.8 seconds \u2014 the upgrade that changes that is scheduled, not shipped. What is actually live, what is not, and why the roadmap is a latency story rather than a TPS one.",
    category: "engineering",
    date: "2026-09-07",
    readMins: 15,
    cover: "/blog/solana-2026.svg",
    author: "Ashutosh Kumar Singh",
    body: [
      {
        type: "p",
        text: "On 21 August 2026, at epoch 1020, Solana reduced its target slot time below 400 milliseconds for the first time since the network launched. A week later it went lower again. Neither change added a feature, and neither shows up in a throughput chart.",
      },
      {
        type: "p",
        text: "That is the interesting part. Solana spent most of its public life being measured in transactions per second, and the 2026 work is not primarily about that number. It is about how long the whole round trip takes — submit, propagate, execute, include, finalise — which is the number that decides whether a blockchain can sit underneath a payment or a trade.",
      },
      {
        type: "p",
        text: "Four things changed or are changing at once: block production got faster, block capacity got larger, transactions got bigger, and the consensus algorithm that decides finality is being replaced outright. This is what each one actually does, what is live today, and what is still scheduled.",
      },
      { type: "h2", text: "What is live, and what is not, as of 7 September 2026" },
      {
        type: "p",
        text: "Coverage of this roadmap mixes shipped upgrades with announced ones fairly freely, so it is worth separating them before anything else.",
      },
      {
        type: "table",
        headers: ["Change", "Status", "When"],
        rows: [
          ["100M compute-unit blocks (SIMD-0286)", "LIVE on mainnet", "29 July 2026, epoch 1009"],
          ["350ms slot time (SIMD-0525 phase 1)", "LIVE on mainnet", "21 August 2026, epoch 1020"],
          ["300ms slot time (SIMD-0525 phase 2)", "LIVE on mainnet", "~28 August 2026, epoch 1024"],
          ["4,096-byte transactions (v1 format)", "Shipped in Agave 4.2", "August 2026"],
          ["250ms and 200ms slot times", "Scheduled, gated on safety metrics", "Not yet activated"],
          ["Alpenglow consensus (Votor)", "SCHEDULED, not active", "Targeted 28 September 2026 with Agave 4.3"],
          ["Rotor propagation layer", "Later phase, separate proposal", "Not scheduled"],
        ],
        highlightCol: 1,
      },
      {
        type: "p",
        text: "The last three rows are the ones most often reported as though they had already happened. Alpenglow in particular: the complete codebase, Votor included, shipped inside Agave 4.2, but mainnet activation was deliberately withheld pending further hardening and a 50,000 SOL bug bounty that ran through August. The code being merged is not the same as the algorithm being live.",
      },
      { type: "h2", text: "SIMD-0525: shorter slots, in deliberate steps" },
      {
        type: "p",
        text: "A slot is the window in which one validator — the leader for that slot — may produce a block. Solana ran a 400ms target from genesis until August 2026. SIMD-0525 walks that down in 50ms steps rather than jumping straight to the destination.",
      },
      {
        type: "table",
        headers: ["Stage", "Target slot time", "Status"],
        rows: [
          ["Baseline", "400ms", "From genesis until August 2026"],
          ["Phase 1", "350ms", "Live — epoch 1020, 21 August 2026"],
          ["Phase 2", "300ms", "Live — epoch 1024, ~28 August 2026"],
          ["Phase 3", "250ms", "Scheduled"],
          ["Phase 4", "200ms", "Scheduled"],
        ],
        highlightCol: 1,
      },
      {
        type: "p",
        text: "The staging is the engineering, not a formality. Shorter slots compress every deadline in the pipeline at once: a leader has less time to build and broadcast a block, and every other validator has less time to receive and replay it. Push too far and validators start missing their slots, which shows up as a rising skip rate. Each phase is gated on those safety metrics rather than on a calendar, and all four stages are targeted at Agave v4.2 with timing described as tentative.",
      },
      {
        type: "p",
        text: "There is a second effect that has nothing to do with speed. A shorter slot is a shorter period during which a single leader controls what goes into a block, and Solana describes the reduction as carrying a censorship-resistance and fairness benefit for exactly that reason. It narrows the window for reordering.",
      },
      {
        type: "quote",
        text: "Halving the slot time halves how long any one validator holds the pen.",
      },
      { type: "h2", text: "Slot time is not finality, and the gap is enormous" },
      {
        type: "p",
        text: "This distinction does more work than any other in understanding the 2026 roadmap, and it is routinely collapsed.",
      },
      {
        type: "p",
        text: "A SLOT is how often a block can be produced. FINALITY is when the network will treat that block as irreversible. Under Solana's existing TowerBFT consensus, rooted finality takes roughly 12.8 seconds — a figure unchanged by any slot-time reduction, because they are different mechanisms.",
      },
      {
        type: "p",
        text: "So a 300ms slot time and a 12.8-second finality are both true statements about Solana today. An application that waits for rooted finality waits nearly thirteen seconds no matter how fast blocks are produced. Most Solana applications do not wait — they act on optimistic confirmation — but the distinction is exactly what a payment processor or an exchange has to reason about.",
      },
      {
        type: "p",
        text: "Alpenglow is the upgrade that attacks the second number, and it is why it matters more than the slot-time work.",
      },
      { type: "h2", text: "Alpenglow: replacing the consensus algorithm" },
      {
        type: "p",
        text: "Alpenglow replaces TowerBFT with a new voting algorithm called Votor, targeting roughly 150ms finality against today's roughly 12.8 seconds. That is not an incremental improvement. It is a reduction of about two orders of magnitude in the time between a block being produced and being irreversible.",
      },
      {
        type: "p",
        text: "Votor works in two rounds. If at least 80% of active stake votes to notarise a block in the first round, it can finalise there. If that threshold is not met, a second round with a 60% threshold determines whether the block is finalised, notarised or skipped. Fast when the network is healthy and synchronised, with a slower path that still makes progress when it is not.",
      },
      {
        type: "p",
        text: "Two changes underneath matter as much as the headline number.",
      },
      {
        type: "ul",
        items: [
          "Votes move off the transaction pipeline. Validator votes were previously ordinary on-chain transactions competing for the same block space as user activity. Under Alpenglow validators exchange votes directly, so consensus traffic stops consuming capacity that users are also bidding for.",
          "Fault tolerance rises from 33% to 40%. Votor is designed on a '20+20' basis: tolerating 20% of stake being offline alongside 20% being actively adversarial. That is a stronger safety property than the design it replaces, not merely a faster one.",
        ],
      },
      {
        type: "p",
        text: "Rotor, a redesigned block-propagation layer intended to replace Turbine, is part of the wider Alpenglow research but is a later phase with its own proposal process. It should not be described as shipping with the initial consensus change.",
      },
      {
        type: "p",
        text: "On timing, the sources genuinely disagree and it is worth saying so rather than picking. Anza's Agave 4.3 release schedule, published 12 August, names 28 September 2026 as the start of feature activation on mainnet. Earlier Solana Foundation guidance pointed at October 2026. Either way, as of 7 September the algorithm is not live, and a scheduled activation date is a plan rather than an event.",
      },
      { type: "h2", text: "100M compute-unit blocks, and the limit that did not move" },
      {
        type: "p",
        text: "On 29 July 2026, at epoch 1009, SIMD-0286 raised the maximum block compute limit from 60 million compute units to 100 million — a 66% increase. Compute units are Solana's measure of computational work; the block limit caps how much total work a single block may contain.",
      },
      {
        type: "p",
        text: "The proposal was authored by Jito Labs and justified by observed demand rather than by aspiration: between the previous limit's activation in July 2025 and this upgrade, 11.2% of blocks used at least 56M CUs. Roughly one block in nine was running close to the ceiling, and that demand arrives in spikes during volatile markets — precisely when the people submitting transactions most want them to land.",
      },
      {
        type: "p",
        text: "One detail is consistently dropped in summaries and matters for anyone designing around it: SIMD-0286 raised exactly one limit. Maximum WRITABLE ACCOUNT units — the most compute that may write to any single account within one block — stayed at 12M. If your program funnels activity through one hot account, the block getting bigger does not raise your ceiling. That per-account limit is what bounds a single popular market or mint, and it is unchanged.",
      },
      {
        type: "quote",
        text: "The block got 66% bigger. The busiest account in it did not.",
      },
      { type: "h2", text: "4,096-byte transactions" },
      {
        type: "p",
        text: "Solana's transaction size limit was approximately 1,232 bytes, a figure inherited from the IPv6 minimum MTU — the largest packet size that can be relied upon to traverse the internet without fragmentation. The v1 transaction format raises it to 4,096 bytes, roughly 3.3 times more room.",
      },
      {
        type: "p",
        text: "Some applications were never constrained by compute. They were constrained by how much would fit in one transaction: large multisig operations, zero-knowledge proofs, wide account reference lists, batched operations that previously had to be split into several chained transactions and lose atomicity in the process.",
      },
      {
        type: "p",
        text: "Legacy and v0 transactions continue to work. The larger size requires adopting v1, which means it is a migration for applications rather than something that arrives automatically.",
      },
      { type: "h2", text: "Firedancer, and why client diversity is the point" },
      {
        type: "p",
        text: "Firedancer is an independent validator implementation written in C and C++ by Jump Crypto — a ground-up rewrite rather than a fork of the Agave codebase. Its architecture divides validator work into specialised components called tiles, each pinned to dedicated CPU cores: networking, signature verification, execution. It bypasses much of the operating system's networking stack to avoid copying packets more than necessary.",
      },
      {
        type: "p",
        text: "Firedancer has demonstrated over 1,000,000 TPS in isolated hardware testing. That figure is widely quoted and widely misunderstood, so it is worth being precise: a laboratory benchmark on dedicated hardware is not sustained economic throughput on a live decentralised network. Real mainnet throughput is bounded by consensus, propagation across a globally distributed validator set, and actual demand — not by how fast one machine can verify signatures.",
      },
      {
        type: "p",
        text: "The significant thing about Firedancer is not its benchmark. It is that Solana stops depending on a single implementation. When one codebase runs the entire network, a bug in it is a network-wide failure with no independent implementation to keep producing blocks. Client diversity converts a correlated failure into an isolated one.",
      },
      {
        type: "p",
        text: "Frankendancer was the transition: a hybrid pairing Firedancer's networking and ingestion with Agave's runtime and consensus, which let the ecosystem run Firedancer code in production incrementally rather than as a single cutover. Through August 2026, releases were shipping for Agave, Firedancer and Frankendancer in parallel.",
      },
      {
        type: "quote",
        text: "A benchmark tells you what one machine can do. Client diversity tells you what happens when that machine is wrong.",
      },
      { type: "h2", text: "The bottleneck that is not execution" },
      {
        type: "p",
        text: "There is a failure mode that no amount of execution speed addresses: a transaction that never reaches the leader cannot be included, however fast the runtime is.",
      },
      {
        type: "p",
        text: "Stake-weighted Quality of Service allocates transaction-forwarding bandwidth according to validator stake rather than treating every connection identically. The reasoning is that a validator with meaningful stake has a proportionate role in consensus, so its share of scarce propagation capacity should reflect that. It matters most under exactly the conditions where it is hardest to test — congestion, when propagation itself becomes the scarce resource.",
      },
      {
        type: "p",
        text: "This is why framing Solana's scaling as an execution problem misses most of it. The real question is end to end: how quickly can a transaction reach the right validator, be verified, executed, propagated to the rest of the network, and finalised. The 2026 roadmap touches every stage of that sequence, which is unusual — most scaling work picks one.",
      },
      { type: "h2", text: "What this means for payments" },
      {
        type: "p",
        text: "A stablecoin payment on any chain has to do six things: construct the transaction, propagate it to the leader, execute it, include it in a block, reach sufficient consensus, and report back. Improving one stage produces a partial improvement; the user experiences the sum.",
      },
      {
        type: "p",
        text: "The combination that matters for payments is 300ms slots plus 100M-CU blocks plus faster finality. Shorter slots reduce the wait for inclusion. Larger blocks reduce the chance of being crowded out during a spike. And if Alpenglow lands as designed, the wait for irreversibility drops from something a merchant cannot build around to something they need not think about.",
      },
      {
        type: "p",
        text: "That last one is the qualitative change. A payment system that must wait 12.8 seconds for finality either waits, or accepts risk on optimistic confirmation and manages it. At 150ms the question largely stops being a question — which is the point at which settlement stops being a design constraint and becomes an implementation detail.",
      },
      { type: "h2", text: "What this means for trading" },
      {
        type: "p",
        text: "Trading is more sensitive to latency than to throughput, and the two are routinely conflated. A venue does not primarily care how many transactions the network can process in aggregate; it cares how long its own order takes to reach a leader, execute, and come back as a known result.",
      },
      {
        type: "p",
        text: "Shorter slots reduce the wait between block opportunities. Larger blocks provide headroom when everyone submits at once, which is when it counts. Faster finality shortens the interval during which a filled order is not yet certain. And a shorter leader window narrows the period in which a single party can reorder what they are including.",
      },
      {
        type: "p",
        text: "This is the reason a headline TPS number is a poor summary of a trading venue's requirements. Aggregate capacity and individual latency are different properties, and a chain can improve one while leaving the other untouched.",
      },
      { type: "h2", text: "What does not automatically get faster" },
      {
        type: "p",
        text: "Protocol improvements set a floor. They do not determine what an application actually experiences, and several constraints sit outside the protocol entirely.",
      },
      {
        type: "ul",
        items: [
          "Geography. Light takes time. A validator set distributed globally has an irreducible round-trip latency that no consensus algorithm removes.",
          "RPC infrastructure. Most applications reach Solana through an RPC provider. If that layer is slow or rate-limited, protocol latency is not what the user is waiting on.",
          "The per-account write limit. Still 12M CUs. Applications concentrated on one hot account do not benefit from the larger block.",
          "Validator hardware. Shorter slots compress every deadline, which raises the specification required to keep up. That has implications for who can afford to validate.",
          "Application design. A transaction that makes several sequential round trips before it is submitted spends most of its time before it reaches the chain at all.",
        ],
      },
      {
        type: "p",
        text: "Alpenglow illustrates the general point. It has to hold safety across a globally distributed validator set under adversarial conditions, which is why it is being staged, bug-bountied and gated rather than shipped as a routine release. The same logic explains SIMD-0525's 50ms increments. The target is not the highest number the protocol can express; it is the highest number the live, decentralised network sustains safely.",
      },
      { type: "h2", text: "Solana, before and now" },
      {
        type: "table",
        headers: ["Metric", "Historical", "As of 7 September 2026", "Next"],
        rows: [
          ["Slot time", "400ms", "300ms, live", "250ms then 200ms, scheduled"],
          ["Consensus finality", "~12.8s (TowerBFT)", "Unchanged — Alpenglow not yet active", "~150ms target (Votor)"],
          ["Block compute limit", "60M CUs", "100M CUs, live", ""],
          ["Per-account write limit", "12M CUs", "12M CUs, unchanged", ""],
          ["Transaction size", "1,232 bytes", "4,096 bytes (v1 format)", ""],
          ["Fault tolerance", "33%", "33%", "40% under Alpenglow"],
          ["Validator clients", "Agave-dominated", "Agave + Firedancer/Frankendancer", "Further diversity"],
          ["Consensus votes", "On-chain transactions", "On-chain", "Off-pipeline under Alpenglow"],
          ["Block propagation", "Turbine", "Turbine", "Rotor, later phase"],
        ],
        highlightCol: 2,
      },
      {
        type: "p",
        text: "Reading down the third column is the honest summary of where the network actually is: capacity and block production have already changed, and the consensus work that produces the headline finality number has not landed yet.",
      },
      { type: "h2", text: "The change underneath all of it" },
      {
        type: "p",
        text: "The most consequential thing about Solana's 2026 work may not be any individual proposal. It is that the network is being engineered around latency as a first-class property rather than throughput.",
      },
      {
        type: "p",
        text: "The older scaling model asked how many transactions per second a chain could process. It produced impressive numbers and, frequently, applications that still felt slow, because aggregate capacity says nothing about how long any particular transaction waits. Propagation, congestion, execution and finality are separate bottlenecks, and a chain can be excellent at one while a user waits on another.",
      },
      {
        type: "p",
        text: "Solana's current roadmap addresses them individually and concurrently: propagation through stake-weighted networking and eventually Rotor, execution through larger blocks, block production through shorter slots, finality through Alpenglow, and the risk of a single implementation through Firedancer. The objective across all five is the same, and it is not a number — it is that the blockchain stops being something the application has to work around.",
      },
      {
        type: "quote",
        text: "The end state is not a bigger number. It is submit, execute, settle — with nothing in between that a user has to understand.",
      },
      { type: "h2", text: "Frequently asked questions" },
      { type: "h2", text: "How fast are Solana blocks in 2026?" },
      {
        type: "p",
        text: "Solana's target slot time is 300ms, live on mainnet since around 28 August 2026 at epoch 1024. That followed the first reduction since genesis, to 350ms, at epoch 1020 on 21 August 2026. SIMD-0525 schedules further reductions to 250ms and then 200ms, gated on network safety metrics rather than fixed dates.",
      },
      { type: "h2", text: "Is Alpenglow live on Solana mainnet?" },
      {
        type: "p",
        text: "No, not as of 7 September 2026. The complete Alpenglow codebase including Votor shipped in Agave 4.2, but mainnet activation was withheld pending hardening and a 50,000 SOL bug bounty. Anza's Agave 4.3 release schedule targets 28 September 2026 for the start of feature activation; earlier Solana Foundation guidance indicated October 2026. Prerequisites such as BLS key registration are already active, which is not the same as the consensus algorithm being live.",
      },
      { type: "h2", text: "How fast will Solana finality be with Alpenglow?" },
      {
        type: "p",
        text: "Approximately 150ms is the stated target, against roughly 12.8 seconds for rooted finality under the current TowerBFT design. Votor finalises in one round if at least 80% of active stake notarises the block, with a second round at a 60% threshold as the fallback.",
      },
      { type: "h2", text: "What is the difference between slot time and finality?" },
      {
        type: "p",
        text: "A slot is how often a block can be produced; finality is when the network treats a block as irreversible. They are separate mechanisms. Solana produces blocks every 300ms today while rooted finality still takes roughly 12.8 seconds, because slot-time reductions and consensus changes address different parts of the system.",
      },
      { type: "h2", text: "Did Solana raise the block compute limit to 100M?" },
      {
        type: "p",
        text: "Yes. SIMD-0286, authored by Jito Labs, raised the maximum block compute limit from 60M to 100M compute units — a 66% increase — on 29 July 2026 at epoch 1009. The maximum writable account limit was not changed and remains 12M CUs.",
      },
      { type: "h2", text: "What is the new Solana transaction size limit?" },
      {
        type: "p",
        text: "The v1 transaction format raises it from approximately 1,232 bytes to 4,096 bytes, roughly 3.3 times more space. The old limit derived from the IPv6 minimum MTU. Legacy and v0 transactions still work; using the larger size requires adopting v1.",
      },
      { type: "h2", text: "What is Firedancer?" },
      {
        type: "p",
        text: "An independent Solana validator implementation written in C and C++ by Jump Crypto, built from the ground up rather than forked from Agave. It divides work into specialised tiles pinned to dedicated CPU cores and bypasses much of the OS networking stack. Its significance is client diversity: when one implementation runs an entire network, a bug in it becomes a network-wide failure.",
      },
      { type: "h2", text: "Can Solana really do 1 million TPS?" },
      {
        type: "p",
        text: "Firedancer has exceeded 1,000,000 TPS in isolated hardware testing. That is a laboratory benchmark, not sustained throughput on a live decentralised network, where performance is bounded by consensus, propagation across a global validator set and actual demand. The two figures measure different things and should not be used interchangeably.",
      },
      { type: "h2", text: "What is Frankendancer?" },
      {
        type: "p",
        text: "A hybrid validator pairing Firedancer's networking and transaction ingestion with Agave's runtime and consensus. It let Firedancer code run in production incrementally instead of requiring a single cutover to a wholly new client.",
      },
      { type: "h2", text: "Does a faster Solana make my application faster?" },
      {
        type: "p",
        text: "Not automatically. Protocol latency is a floor, not a guarantee. Geographic distance, RPC provider performance, the unchanged 12M per-account write limit, validator hardware and the application's own round trips before submission all sit outside the protocol and frequently dominate what a user actually experiences.",
      },
      { type: "h2", text: "Sources, and what could not be pinned down" },
      {
        type: "p",
        text: "Figures are from Solana's own upgrade documentation and changelogs, the solana-improvement-documents repository, Anza's feature-gate tracker and release schedules, and contemporaneous reporting from late July through August 2026. Status is stated as of 7 September 2026 and will move.",
      },
      {
        type: "p",
        text: "Three points where sources disagree or where a widely repeated figure did not hold up, stated rather than smoothed over:",
      },
      {
        type: "ul",
        items: [
          "The block compute limit before SIMD-0286 was 60M CUs, not 48M. The 48M figure circulates but the proposal and Solana's own announcement both describe 60M to 100M as a 66% increase, which is arithmetically consistent with 60M and not with 48M.",
          "Alpenglow's activation date is reported as both 28 September 2026 (Anza's Agave 4.3 release schedule, published 12 August) and October 2026 (earlier Solana Foundation guidance). Both are plans, and neither has occurred as of publication.",
          "Epoch numbering for the 300ms activation is given as epoch 1024 in reporting and appears differently in at least one implementation pull request. The activation date of late August is consistent across sources; the exact epoch is not, so the date is what this article relies on.",
        ],
      },
      {
        type: "p",
        text: "One further figure was left out for lack of a source we could verify: a specific percentage of block space consumed by vote transactions under the current design. The direction is well established — votes compete with user transactions, and Alpenglow removes them from that pipeline — but the precise share is quoted inconsistently and is not reproduced here.",
      },
    ],
  },
  // Stablecoin market analysis, September 2026.
  //
  // METRIC DISCIPLINE IS THE POINT OF THIS PIECE. Six different measurements
  // appear in coverage of this market and are routinely used interchangeably:
  // market capitalisation, circulating supply, raw transaction count, adjusted
  // transaction volume, company-reported on-chain volume, and card settlement
  // volume. They have different leaders. Do not merge them when editing.
  //
  // VERIFIED BEFORE PUBLICATION:
  //   - June 2026 adjusted volume $1.79tn, +63% MoM, +125% YoY. USDC ~67%
  //     ($1.21tn), USDT ~32% ($576bn), PYUSD ~$2.42bn. H1 2026 $8.82tn vs
  //     $10.8tn for all of 2025. (Visa Onchain Analytics / Allium)
  //   - Circle Q2 2026, company-reported 5 Aug 2026: $14.8tn on-chain volume
  //     +151% YoY, $163bn/day average, $73.3bn circulation at quarter end
  //     +19% YoY, $76.5bn average circulation, $701m revenue, $143m adj EBITDA.
  //     Arc mainnet announced for 16 Sep 2026.
  //   - Visa: US USDC settlement on Solana announced Dec 2025, Cross River and
  //     Lead Bank initial partners, $3.5bn annualised run rate as of 30 Nov.
  //     A LATER report describes nine chains at ~$7bn annualised. DIFFERENT
  //     SCOPE AND DATE — both are stated, never combined.
  //   - Mastercard/BVNK: announced 17 Mar 2026, closed 3 Aug 2026, up to
  //     $1.8bn, ~$30bn annual volume reported at closing.
  //   - Stripe/Bridge $1.1bn, Feb 2025.
  //   - Networks: Base ~$565bn (31.5%), Ethereum ~$562bn (31.4%), Tron ~$320bn,
  //     Solana ~$225bn. Base/Ethereum margin is ~$3bn on $1.79tn — the piece
  //     says explicitly that the ordering is period-specific.
  //   - Visa card tokenization ~35% of transactions, ~50% of Visa e-commerce,
  //     ~4.6% CNP authorisation uplift.
  //
  // Ranges from source material are preserved as ranges. Company-reported
  // figures are labelled as such throughout.
  {
    slug: "stablecoin-transaction-volume-2026-circle-usdc-tether-usdt",
    title: "Stablecoin Transaction Volume in 2026: Circle, Tether and the Race to Build the Payment Rail",
    seoTitle:
      "Stablecoin Transaction Volume 2026: Circle USDC vs Tether USDT Market Analysis",
    excerpt:
      "Stablecoins settled $1.79 trillion in adjusted transaction volume in June 2026, up 125% year on year. USDC accounted for approximately 67% of that volume; USDT remains the largest stablecoin by market capitalisation at more than $185 billion. An analysis of what each metric measures, where Circle and Tether actually stand, and what Visa, Mastercard, Stripe, PayPal and Coinbase are building around them.",
    category: "compliance",
    date: "2026-09-07",
    readMins: 15,
    cover: "/blog/stablecoin-leaders-2026.svg",
    author: "Ashutosh Kumar Singh",
    body: [
      {
        type: "p",
        text: "Stablecoins settled $1.79 trillion in adjusted transaction volume in June 2026 — a monthly record, up 63% from May and 125% from a year earlier. For context, the first half of 2026 produced $8.82 trillion in adjusted volume, already approaching the $10.8 trillion recorded across all of 2025.",
      },
      {
        type: "p",
        text: "Numbers at that scale invite a simple question: who is leading? The answer depends entirely on which measurement you use, and the two most commonly cited measurements currently have different leaders.",
      },
      {
        type: "p",
        text: "Circle's USDC leads adjusted transaction volume, accounting for approximately 67% of the June total. Tether's USDT remains the largest stablecoin by market capitalisation, with more than $185 billion in circulation. Both are accurate descriptions of the same market, measuring different things.",
      },
      {
        type: "p",
        text: "This article sets out what each metric captures, where the two issuers actually stand, and what Visa, Mastercard, Stripe, PayPal and Coinbase have been building around them.",
      },
      { type: "h2", text: "The market has reached a new scale" },
      {
        type: "p",
        text: "The June 2026 figures come from Visa Onchain Analytics, a public dashboard Visa built with the blockchain data firm Allium Labs. It reports adjusted stablecoin transaction volume — a filtered measure described in detail below.",
      },
      {
        type: "table",
        headers: ["Measure", "June 2026", "Change"],
        rows: [
          ["Total adjusted stablecoin volume", "$1.79tn", "+63% month on month, +125% year on year"],
          ["USDC share", "~$1.21tn", "~67% of the monthly total"],
          ["USDT share", "~$576bn", "~32% of the monthly total"],
          ["PYUSD", "~$2.42bn", "Third by adjusted volume"],
          ["H1 2026 cumulative", "$8.82tn", "Against $10.8tn for all of 2025"],
        ],
        highlightCol: 1,
      },
      {
        type: "p",
        text: "Two features of that table are worth noting. The growth rate is steep by any standard, and the distribution is highly concentrated: the top two stablecoins account for approximately 99% of adjusted volume, with the third-largest roughly two orders of magnitude behind the second.",
      },
      { type: "h2", text: "What adjusted transaction volume measures" },
      {
        type: "p",
        text: "Raw on-chain volume counts every stablecoin transfer recorded on a blockchain. A significant share of that activity is automated rather than economic: arbitrage between trading venues, automated market-maker rebalancing, maximal extractable value (MEV) strategies, flash loans that borrow and repay within a single transaction, and smart-contract routing where the same value passes through several addresses en route to one destination.",
      },
      {
        type: "p",
        text: "Adjusted volume applies filters intended to remove that activity and approximate transfers with genuine economic intent — payments, settlements, treasury movements. It is an estimate produced by a defined methodology, not a directly observed quantity, and the choice of filters is a legitimate subject of technical debate.",
      },
      {
        type: "p",
        text: "The distinction matters for interpretation. Raw volume answers 'how much moved on-chain'. Adjusted volume attempts to answer 'how much moved for a commercial reason'. Most people asking which stablecoin is used more are asking the second question.",
      },
      { type: "h2", text: "Circle and USDC" },
      {
        type: "p",
        text: "Circle reported its Q2 2026 results on 5 August 2026. The company-reported figures:",
      },
      {
        type: "ul",
        items: [
          "USDC on-chain transaction volume of $14.8 trillion in Q2 2026, growing 151% year on year",
          "Daily on-chain transaction volume averaging $163 billion across the quarter, also up 151% year on year",
          "USDC in circulation of $73.3 billion at quarter end, up 19% year on year",
          "Average USDC circulation of $76.5 billion during the quarter, an all-time high",
          "Total revenue and reserve income of $701 million, up 7% year on year, with adjusted EBITDA of $143 million",
        ],
      },
      {
        type: "p",
        text: "The gap between those two growth rates — circulation up 19%, transaction volume up 151% — describes how USDC is used. The same supply is turning over considerably faster than it is growing, which is the signature of a payment instrument rather than a store of value.",
      },
      {
        type: "p",
        text: "Circle's position is concentrated in institutional and business flows: settlement between financial institutions, business-to-business cross-border payments, fintech and marketplace payouts, corporate treasury movement, and payment-processor settlement legs. These transactions are large, occur repeatedly between the same counterparties, and are unambiguously commercial — exactly the activity adjusted volume is designed to capture.",
      },
      {
        type: "p",
        text: "Circle's Cross-Chain Transfer Protocol supports this by moving USDC between blockchains through a burn-and-mint mechanism rather than a third-party bridge, which removes the bridge-custody risk that institutional counterparties typically will not accept. Circle has also announced a public mainnet launch for its Arc blockchain on 16 September 2026.",
      },
      { type: "h2", text: "Tether and USDT" },
      {
        type: "p",
        text: "USDT remains the largest stablecoin by circulating supply, with more than $185 billion outstanding — roughly 59% of total stablecoin market capitalisation. Tether reportedly generates over $1 billion per quarter in net profit, primarily from yield on the US Treasury holdings backing that supply.",
      },
      {
        type: "p",
        text: "USDT also leads raw transaction count. Its activity is concentrated in different use cases from USDC's: over-the-counter trading, exchange liquidity and trading pairs, peer-to-peer transfers, and dollar access in economies where obtaining and holding dollars through the banking system is difficult or expensive.",
      },
      {
        type: "p",
        text: "That last category is significant in reach if not in dollar volume. Much of it runs on Tron, which handles roughly $320 billion of monthly adjusted volume — about 18% of the global total — largely through retail corridors in Latin America and Asia where low transaction fees make small transfers economically viable.",
      },
      {
        type: "quote",
        text: "Small transfers move fewer dollars per transaction than institutional settlement does. A metric denominated in dollars will therefore always understate a use case denominated in people.",
      },
      { type: "h2", text: "Why the two rankings differ" },
      {
        type: "table",
        headers: ["", "Circle / USDC", "Tether / USDT"],
        rows: [
          ["Market capitalisation", "~$73.3bn at Q2 2026 quarter end (company-reported)", "More than $185bn, ~59% of the market"],
          ["Adjusted transaction volume, June 2026", "~$1.21tn, ~67% share", "~$576bn, ~32% share"],
          ["On-chain transaction volume", "$14.8tn in Q2 2026, +151% YoY (company-reported)", "Leads on raw transaction count"],
          ["Principal networks", "Base, Ethereum, Solana, Polygon", "Tron, Ethereum, TON, Solana"],
          ["Principal use cases", "Institutional settlement, B2B cross-border, fintech payouts, treasury", "OTC, exchange liquidity, P2P transfers, dollar access"],
          ["Infrastructure", "Cross-Chain Transfer Protocol; Arc mainnet announced for 16 Sep 2026", "Hadron tokenization platform; trade-finance expansion"],
        ],
        highlightCol: 1,
      },
      {
        type: "p",
        text: "The divergence is structural. A stablecoin held as a dollar substitute contributes to circulating supply for as long as it is held and generates no settlement volume while held. A stablecoin used as a payment rail can settle the same dollar many times within a month, contributing repeatedly to transaction volume without changing supply at all.",
      },
      {
        type: "p",
        text: "Velocity, in other words, is the variable. USDC circulation grew 19% year on year while its transaction volume grew 151%. Neither behaviour is a deficiency; they are different products serving different demand.",
      },
      {
        type: "quote",
        text: "Market capitalisation measures how much of a stablecoin exists. Adjusted transaction volume measures how hard it is working. A complete picture requires both.",
      },
      { type: "h2", text: "Where the volume settles" },
      {
        type: "p",
        text: "Adjusted volume by network for June 2026, from the same Visa Onchain Analytics dataset:",
      },
      {
        type: "table",
        headers: ["Network", "Monthly adjusted volume", "Share", "Principal stablecoins", "Dominant activity"],
        rows: [
          ["Base", "~$565bn", "~31.5%", "USDC", "Sub-cent fees; direct Stripe and Coinbase wallet integration"],
          ["Ethereum", "~$562bn", "~31.4%", "USDC, USDT", "High-value institutional settlement, treasury movement"],
          ["Tron", "~$320bn", "~17.9%", "USDT", "Retail payments, P2P corridors in Latin America and Asia"],
          ["Solana", "~$225bn", "~12.5%", "USDC, PYUSD", "High-throughput merchant checkout, DeFi liquidity"],
          ["Others", "~$118bn", "~6.7%", "USDC, USDS", "Rollup liquidity, regional fintech deployments"],
        ],
        highlightCol: 2,
      },
      {
        type: "p",
        text: "Base and Ethereum are separated by roughly $3 billion in a $1.79 trillion month — a margin narrow enough that the ordering should be treated as a snapshot rather than a standing rank. Their profiles differ regardless: Base's share comes substantially from high-frequency, low-fee flows, Ethereum's from fewer transactions of higher individual value, where settlement finality outweighs transaction cost.",
      },
      {
        type: "p",
        text: "One methodological note: this table ranks by transaction VALUE, not transaction COUNT. A network can lead one and not the other, and the two are frequently reported interchangeably.",
      },
      { type: "h2", text: "The stablecoin leaderboard" },
      {
        type: "p",
        text: "Market capitalisations are Q3 2026 estimates and move continuously; adjusted-volume shares are H1 2026 estimates from the Visa/Allium dataset. The two columns measure different things and are shown together to make the distinction visible.",
      },
      {
        type: "table",
        headers: ["#", "Stablecoin", "Issuer", "Market cap (est.)", "Adj. volume share (est.)", "Principal use"],
        rows: [
          ["1", "USDT", "Tether", "~$183–186bn", "~25–32%", "OTC, exchange liquidity, emerging-market dollar access"],
          ["2", "USDC", "Circle", "~$72–75bn", "~67–70%", "Institutional settlement, B2B, fintech payouts"],
          ["3", "USDS / DAI", "Sky", "~$4.8–5.4bn", "~1.5%", "DeFi collateral and lending"],
          ["4", "USD1", "World Liberty Financial", "~$4.0–4.7bn", "<1%", "DeFi liquidity, institutional yield"],
          ["5", "USDe", "Ethena Labs", "~$3.9–5.2bn", "~1.2%", "Synthetic delta-neutral basis trading"],
          ["6", "USDG", "Paxos / Global Dollar Network", "~$3.2–3.5bn", "<1%", "Enterprise rewards-sharing network"],
          ["7", "PYUSD", "PayPal / Paxos", "~$2.5–2.7bn", "~0.2–0.5%", "Consumer P2P, checkout, remittances"],
          ["8", "RLUSD", "Ripple", "~$1.5–1.6bn", "<0.2%", "Bank corridor settlement"],
          ["9", "USDD", "TRON DAO Reserve", "~$1.4–1.6bn", "<0.2%", "Tron DeFi liquidity"],
          ["10", "FDUSD", "First Digital", "~$1.1–1.3bn", "~0.5%", "Exchange trading pairs"],
        ],
        highlightCol: 4,
      },
      {
        type: "p",
        text: "Sorting by either column produces a different top two. Below the top two, both measures fall away sharply — the third-ranked asset holds under 2% on either.",
      },
      { type: "h2", text: "Visa and stablecoin settlement" },
      {
        type: "p",
        text: "A distinction is useful before the detail. In card payments, AUTHORISATION is the real-time approval of a transaction at the point of purchase. SETTLEMENT is the movement of funds between financial institutions afterwards, typically on a delayed cycle. Visa's stablecoin work sits almost entirely on the settlement side.",
      },
      {
        type: "p",
        text: "Visa announced US stablecoin settlement in December 2025, enabling issuer and acquirer partners to settle with Visa in USDC on Solana — initially with Cross River Bank and Lead Bank, and a broader rollout expected through 2026. Because blockchains operate continuously, participating institutions can settle on weekends and holidays, when traditional settlement systems are closed.",
      },
      {
        type: "p",
        text: "On disclosed volume, two figures with different scopes and dates are in circulation and should not be combined. Visa reported that monthly stablecoin settlement volume passed a $3.5 billion annualised run rate as of 30 November, in the announcement of the US launch. Later 2026 reporting describes a settlement pilot spanning nine blockchains at approximately a $7 billion annualised rate, growing around 50% quarter on quarter. The first is a US-launch figure; the second is broader in scope and later in date.",
      },
      {
        type: "p",
        text: "Either figure is a small share of Visa's overall payments volume and a meaningful absolute sum. Visa also operates the Visa Tokenized Asset Platform, which allows banks to pilot tokenized deposits, and the Visa Stablecoin Platform, alongside support for 60-plus crypto-linked card programmes where a cardholder spends a stablecoin balance at ordinary merchants.",
      },
      { type: "h2", text: "Two different meanings of tokenization" },
      {
        type: "p",
        text: "The word tokenization is used for two unrelated technologies in payments, and it is worth defining both because Visa is active in each.",
      },
      {
        type: "p",
        text: "CARD-NETWORK TOKENIZATION replaces a card's primary account number — the 16-digit number on the front — with a substitute value called a network token, typically restricted to one device or merchant. It is a security measure for conventional card payments and involves no blockchain. Industry reporting in 2026 places roughly 35% of transactions overall as tokenized, with around half of Visa's e-commerce volume using network tokens; Visa attributes an approximately 4.6% global uplift in card-not-present authorisation rates to token use, because tokens do not expire when a physical card is reissued.",
      },
      {
        type: "p",
        text: "BLOCKCHAIN TOKENIZATION represents an asset — a deposit, a security, a fund share — as a transferable record on a distributed ledger. This is what the Visa Tokenized Asset Platform addresses.",
      },
      {
        type: "p",
        text: "Both are called tokenization. They share the concept of substituting a representation for an underlying value, and nothing else.",
      },
      { type: "h2", text: "Mastercard's acquisition of BVNK" },
      {
        type: "p",
        text: "Mastercard announced an agreement to acquire the stablecoin infrastructure company BVNK on 17 March 2026, in a deal valued at up to $1.8 billion including contingent payments, and completed the acquisition on 3 August 2026. It is the largest stablecoin acquisition recorded to date.",
      },
      {
        type: "p",
        text: "BVNK provides the conversion layer between fiat currency and stablecoins — the on-ramp and off-ramp infrastructure that lets a business accept a payment in one form and settle in another. Reporting at the time of closing indicated BVNK brought approximately $30 billion in annual stablecoin volume.",
      },
      {
        type: "p",
        text: "The strategic logic is about position rather than product. Cross-border B2B payments, payouts and treasury movement all require a controlled boundary between traditional currency and on-chain settlement, and owning that boundary means owning the economics of every transaction crossing it.",
      },
      {
        type: "p",
        text: "The two card networks have taken visibly different routes to the same objective. Mastercard acquired its conversion layer outright; Visa has largely partnered, including work with Stripe-owned Bridge on stablecoin-linked card programmes.",
      },
      { type: "h2", text: "Stripe and Bridge" },
      {
        type: "p",
        text: "Stripe acquired the stablecoin orchestration platform Bridge for $1.1 billion in February 2025, at the time the largest acquisition in the sector. Bridge provides the infrastructure for issuing, converting and moving stablecoins, which Stripe has integrated into its merchant products.",
      },
      {
        type: "p",
        text: "Stripe now supports stablecoin checkout for merchants across more than 150 countries and stablecoin payouts for platforms with distributed contractor and seller bases — a use case where conventional cross-border payout rails are slow and costly relative to transaction size. Its stablecoin support spans USDC, USDP and USDG across Solana, Ethereum and Base.",
      },
      { type: "h2", text: "PayPal and PYUSD" },
      {
        type: "p",
        text: "PayPal issues PYUSD in partnership with Paxos, on Ethereum and Solana. It has been expanded to more than 70 global markets and integrated into PayPal's merchant checkout, with zero-fee cross-border transfers available through Xoom, PayPal's remittance service.",
      },
      {
        type: "p",
        text: "PYUSD's approximately $2.5–2.7 billion market capitalisation and roughly $2.42 billion in June adjusted volume place it third among stablecoins by volume, at a scale roughly two orders of magnitude below the top two. Its distinguishing characteristic is distribution rather than size: PYUSD reaches an existing consumer base that does not otherwise interact with blockchain infrastructure.",
      },
      { type: "h2", text: "Coinbase and Base" },
      {
        type: "p",
        text: "Coinbase co-governs USDC with Circle and operates Base, the Ethereum layer-2 network that led adjusted stablecoin volume in June 2026 at approximately $565 billion, or 31.5% of the monthly total.",
      },
      {
        type: "p",
        text: "Base's position derives from cost and integration together. Transaction fees below one cent make high-frequency settlement viable, and direct integration with Coinbase wallets and Stripe's infrastructure means the network sits inside the products that businesses already use to move USDC. Coinbase also offers zero-fee USDC transactions on Base.",
      },
      {
        type: "p",
        text: "As noted above, Base's lead over Ethereum in this dataset is narrow and period-specific.",
      },
      { type: "h2", text: "The infrastructure race" },
      {
        type: "table",
        headers: ["Company", "Role", "Principal 2026 development"],
        rows: [
          ["Circle", "Issuer and infrastructure", "$14.8tn USDC on-chain volume in Q2 2026, +151% YoY; Arc mainnet announced for 16 Sep 2026"],
          ["Tether", "Issuer", "More than $185bn circulating supply; Hadron tokenization platform; trade-finance expansion"],
          ["Mastercard", "Card network", "Completed $1.8bn BVNK acquisition on 3 Aug 2026, announced 17 Mar 2026"],
          ["Visa", "Card network", "US USDC settlement on Solana with issuer and acquirer partners; VTAP and Visa Stablecoin Platform"],
          ["Stripe", "Merchant acquirer", "Bridge acquisition ($1.1bn, Feb 2025) integrated into checkout and payouts across 150+ countries"],
          ["PayPal", "Consumer payments", "PYUSD expanded to 70+ markets; zero-fee cross-border transfers via Xoom"],
          ["Coinbase", "Exchange and L2", "Base led adjusted stablecoin volume at ~$565bn in June 2026"],
        ],
      },
      {
        type: "p",
        text: "The pattern across these entries is that established payment companies have moved from pilots to permanent infrastructure, and in two cases to nine- and ten-figure acquisitions. Neither card network launched a stablecoin of its own; both invested in the connective layer between existing stablecoins and existing payment rails.",
      },
      { type: "h2", text: "What the activity actually consists of" },
      {
        type: "p",
        text: "The composition of stablecoin volume in 2026 differs from earlier periods. The categories driving adjusted volume are recognisably conventional payment activities:",
      },
      {
        type: "ul",
        items: [
          "Cross-border B2B payments, where correspondent banking is slow and the fee is large relative to the transfer",
          "Marketplace and platform payouts to contractors and sellers across multiple jurisdictions",
          "Corporate treasury movement between entities and accounts",
          "Payment-processor settlement legs between institutions",
          "Merchant checkout, principally on Solana and Base",
          "Remittances, including through consumer-facing services such as Xoom",
        ],
      },
      {
        type: "p",
        text: "These are the flows that card networks, acquirers and processors already serve. The relevant comparison for stablecoin settlement is therefore not other crypto assets but the existing correspondent banking and payout infrastructure it runs alongside.",
      },
      { type: "h2", text: "Who leads, by measure" },
      {
        type: "table",
        headers: ["Measure", "Leader", "Figure", "Period"],
        rows: [
          ["Market capitalisation", "Tether (USDT)", "More than $185bn, ~59% share", "Q3 2026 estimate"],
          ["Adjusted transaction volume", "Circle (USDC)", "~$1.21tn, ~67% share", "June 2026"],
          ["Company-reported on-chain volume", "Circle (USDC)", "$14.8tn in the quarter, +151% YoY", "Q2 2026"],
          ["Raw transaction count", "Tether (USDT)", "Driven by retail and P2P transfers", "2026"],
          ["Network by adjusted volume", "Base, narrowly", "~$565bn vs Ethereum ~$562bn", "June 2026"],
          ["Card-network settlement infrastructure", "Contested", "Mastercard via acquisition; Visa via partnership and direct settlement", "2026"],
        ],
        highlightCol: 1,
      },
      {
        type: "p",
        text: "There is no single figure that resolves the question, because the metrics measure different properties of the same system. Supply, velocity, transaction count, settlement value and infrastructure position are separate variables, and the current leaders differ across them.",
      },
      {
        type: "quote",
        text: "The most durable observation is not which issuer leads a given metric. It is that stablecoins in 2026 are being measured with the vocabulary of payments infrastructure rather than that of crypto assets — settlement volume, payout corridors, conversion layers, run rates.",
      },
      { type: "h2", text: "Frequently asked questions" },
      { type: "h2", text: "Which company leads stablecoin transaction volume in 2026?" },
      {
        type: "p",
        text: "Circle, measured by adjusted transaction volume. USDC accounted for approximately 67% of adjusted stablecoin volume in June 2026 — roughly $1.21 trillion of a $1.79 trillion monthly total, according to Visa Onchain Analytics data produced with Allium Labs. Circle separately reported $14.8 trillion in USDC on-chain transaction volume for Q2 2026, up 151% year on year.",
      },
      { type: "h2", text: "Which stablecoin has the largest market capitalisation?" },
      {
        type: "p",
        text: "USDT. Tether has more than $185 billion in circulating supply, approximately 59% of total stablecoin market capitalisation. USDC is second; Circle reported $73.3 billion in circulation at the end of Q2 2026, up 19% year on year.",
      },
      { type: "h2", text: "Is USDC bigger than USDT?" },
      {
        type: "p",
        text: "By adjusted transaction volume, yes — USDC held roughly a two-to-one lead in June 2026. By market capitalisation, no; USDT is approximately 2.5 times larger. The two metrics measure different properties: how much of a stablecoin exists, versus how much transaction activity it carries.",
      },
      { type: "h2", text: "How much stablecoin volume occurred in June 2026?" },
      {
        type: "p",
        text: "$1.79 trillion in adjusted transaction volume, a monthly record, up 63% from May 2026 and 125% year on year. Cumulative adjusted volume for the first half of 2026 was $8.82 trillion, against $10.8 trillion for the whole of 2025.",
      },
      { type: "h2", text: "What is adjusted stablecoin transaction volume?" },
      {
        type: "p",
        text: "An estimate of stablecoin transfers representing genuine economic activity, produced by filtering raw on-chain volume to remove automated activity such as arbitrage, market-maker rebalancing, MEV strategies, flash loans and internal smart-contract routing. It is a methodology-dependent estimate rather than a directly observed figure.",
      },
      { type: "h2", text: "What role does Visa play in stablecoins?" },
      {
        type: "p",
        text: "Visa enables issuer and acquirer partners to settle with it in USDC, launched in the United States on Solana in December 2025 with Cross River Bank and Lead Bank as initial partners. Visa reported settlement volume passing a $3.5 billion annualised run rate as of 30 November; later 2026 reporting describes a broader nine-blockchain pilot at approximately a $7 billion annualised rate. Visa also operates the Visa Tokenized Asset Platform and Visa Stablecoin Platform and supports 60-plus crypto-linked card programmes. This work concerns settlement between institutions rather than card authorisation.",
      },
      { type: "h2", text: "What did Mastercard's BVNK acquisition accomplish?" },
      {
        type: "p",
        text: "It gave Mastercard ownership of fiat-to-stablecoin conversion infrastructure — the on-ramp and off-ramp layer connecting traditional payment rails to on-chain settlement. Mastercard announced the deal on 17 March 2026 at up to $1.8 billion and completed it on 3 August 2026. Reporting at closing indicated BVNK brought approximately $30 billion in annual stablecoin volume.",
      },
      { type: "h2", text: "Which blockchain has the highest stablecoin volume?" },
      {
        type: "p",
        text: "By adjusted volume in June 2026, Base led at approximately $565 billion (31.5%), narrowly ahead of Ethereum at approximately $562 billion (31.4%). Tron was third at approximately $320 billion (17.9%) and remains the principal network for USDT retail and P2P transfers. The Base/Ethereum margin is narrow enough that the ordering should be treated as period-specific.",
      },
      { type: "h2", text: "What is Circle's USDC transaction volume?" },
      {
        type: "p",
        text: "Circle reported $14.8 trillion in USDC on-chain transaction volume for Q2 2026, growing 151% year on year, with daily volume averaging $163 billion across the quarter. These are company-reported figures from Circle's Q2 2026 results, published 5 August 2026.",
      },
      { type: "h2", text: "What is Tether's market share?" },
      {
        type: "p",
        text: "Approximately 59% of stablecoin market capitalisation, with more than $185 billion in circulating supply. By adjusted transaction volume, USDT's share was approximately 32% in June 2026 — a different metric measuring transaction activity rather than supply.",
      },
      { type: "h2", text: "Sources and methodology" },
      {
        type: "p",
        text: "Adjusted stablecoin transaction volume, issuer shares and network shares are from Visa Onchain Analytics, produced with Allium Labs, for June 2026 and H1 2026. Adjusted volume is a filtered estimate, not a directly observed quantity.",
      },
      {
        type: "p",
        text: "Circle's transaction volume, circulation and financial figures are company-reported from its Q2 2026 results, published 5 August 2026. Visa's stablecoin settlement figures are from its December 2025 US launch announcement ($3.5 billion annualised run rate as of 30 November) and from later 2026 reporting describing a nine-blockchain pilot at approximately $7 billion annualised; these have different scopes and dates and are not combined here.",
      },
      {
        type: "p",
        text: "The Mastercard acquisition of BVNK was announced 17 March 2026 at up to $1.8 billion and completed 3 August 2026. Stripe acquired Bridge for $1.1 billion in February 2025. Visa card-network tokenization percentages are from 2026 industry reporting.",
      },
      {
        type: "p",
        text: "Market capitalisations are estimates that move continuously; where source material provided a range, the range is preserved rather than reduced to a midpoint. Market capitalisation, circulating supply, raw transaction count, adjusted transaction volume, company-reported on-chain volume and card settlement volume are distinct measurements and are not treated as interchangeable at any point in this analysis.",
      },
    ],
  },
  // CLARITY Act / tokenized equities — flagship policy piece, written
  // 2026-09-07, eight days before the Senate cloture vote. Aimed at readers who
  // will check every number: committee staff, bank policy teams,
  // market-structure lawyers. Every figure carries its source and date IN THE
  // SENTENCE for that reason.
  //
  // THREE CLAIMS WERE DELIBERATELY EXCLUDED. Keep them out.
  //   1. BCG's $16.1T-by-2030 figure as CURRENT. BCG revised to $9.4T (April
  //      2025, with Ripple). The stale number appears in most decks and citing
  //      it is the fastest way to be dismissed by this audience. It appears in
  //      the table ONLY, explicitly flagged as superseded.
  //   2. "Kalshi prices 91% that the cloture vote occurs on schedule." Could
  //      not be sourced. Kalshi's published CLARITY markets price ENACTMENT
  //      (~30% before 1 Jul 2027, ~50% before 1 Jan 2028) — a different
  //      question. The article says so explicitly.
  //   3. Any position attributed to JPMorgan, the CFTC or the SEC on the bill.
  //      None is verifiable. The JPMorgan section analyses PUBLISHED Kinexys
  //      activity instead, which is stronger than a position statement.
  //
  // The Kinexys cumulative-volume conflict ($1.5T vs $4T across sources) is
  // surfaced in the text rather than resolved, because we do not know which is
  // right.
  //
  // Do not update a probability here without dating it. An undated probability
  // in a piece about a moving legislative calendar is wrong within a week.
  {
    slug: "clarity-act-tokenized-equities-september-2026",
    // Human headline and SEO title are deliberately different. The headline
    // earns the click on X and LinkedIn, where a full sentence reads as
    // conviction; the SEO title front-loads "CLARITY Act 2026" because the
    // search query is navigational and Google truncates near 60 characters.
    title: "The CLARITY Act Is Not Dead. It Is Running Out of Calendar.",
    seoTitle: "CLARITY Act 2026: What the September 15 Senate Vote Means for Tokenized Equities",
    excerpt:
      "Prediction markets give the CLARITY Act a 15% chance of becoming law in 2026 — and 50% by January 2028. The bill is late, not dead. Meanwhile JPMorgan settles more than $7bn a day in tokenized deposits without waiting for it. What the 15 September Senate vote actually decides, what atomic settlement does and does not fix, and why the strongest objections come from the people who understand market structure best.",
    category: "compliance",
    date: "2026-09-07",
    readMins: 23,
    author: "Ashutosh Kumar Singh",
    featured: true,
    cover: "/blog/clarity-act-odds.svg",
    body: [
      {
        type: "quote",
        text: "STATUS — last checked 7 September 2026. The cloture vote on the motion to proceed is scheduled for 2:15 p.m. ET on Tuesday 15 September 2026 and has not yet taken place. This page is updated in place after the vote rather than replaced, so the analysis below is what we published beforehand.",
      },
      {
        type: "p",
        text: "On Tuesday 15 September 2026 at 2:15 p.m. Eastern, the United States Senate votes on a motion to proceed on H.R. 3633, the Digital Asset Market Clarity Act. It is not a vote on the bill. It is a vote on whether the Senate may begin debating it, and it needs 60 of 100 votes. Republicans hold 53 seats, so at least seven Democrats have to cross.",
      },
      {
        type: "p",
        text: "Prediction markets give the bill roughly a 15% chance of being signed into law in 2026 and roughly a 50% chance of a market-structure law by January 2028. Those numbers answer different questions, and read together they say something precise: the market does not expect the CLARITY Act to fail. It expects the CLARITY Act to run out of days.",
      },
      {
        type: "p",
        text: "That distinction is the whole argument of this piece. A bill that dies for want of votes and a bill that dies for want of floor time look identical on a probability chart and imply opposite strategies for anyone building financial infrastructure. This article is about which one this is, and what follows from the answer.",
      },
      { type: "h2", text: "The CLARITY Act in 60 seconds" },
      {
        type: "p",
        text: "WHAT IT IS. A bill (H.R. 3633) that would write into law which digital assets are securities, which are commodities, and which are payment stablecoins — and which federal agency regulates each. Right now that question has no statutory answer, which is the problem it exists to solve.",
      },
      {
        type: "p",
        text: "WHAT HAPPENS ON 15 SEPTEMBER 2026. The Senate votes at 2:15 p.m. Eastern on whether to START DEBATING the bill. It needs 60 of 100 votes.",
      },
      {
        type: "p",
        text: "DOES IT BECOME LAW THAT DAY? No. This is the first of at least five more steps. A successful vote opens debate; it does not pass anything.",
      },
      {
        type: "p",
        text: "WHY ANYONE SHOULD CARE. The same rules would govern how exchanges operate, who is allowed to hold digital assets on your behalf, whether banks can custody them, and whether shares in a company can legally be issued and settled as digital records. That last one is why this is a financial-markets story, not only a crypto story.",
      },
      {
        type: "p",
        text: "WILL IT PASS? Probably not this year. As of 6 September 2026, prediction markets priced roughly 15% for enactment in 2026 and roughly 50% for a market-structure law by January 2028. The obstacle is the congressional calendar, not the votes.",
      },
      { type: "h2", text: "Two ways to read this" },
      {
        type: "p",
        text: "This article is written for two different readers and you should skip accordingly. If you want the answer: read the 60 seconds above, then 'What happens on 15 September', then the FAQ at the end. That is about four minutes and you will understand the situation better than most coverage of it.",
      },
      {
        type: "p",
        text: "If you want the analysis: the sections from 'Why this is a market-infrastructure bill' onward assume you know what a settlement cycle is, and go into netting, atomic settlement, the SEC/CFTC perimeter and what institutions are already building. That is the part written for people who do this professionally.",
      },
      { type: "h2", text: "Why this matters even if you never buy crypto" },
      {
        type: "p",
        text: "The word 'crypto' does most of the damage in coverage of this bill, because it makes the whole subject sound optional. Here is the version that is not about crypto at all.",
      },
      {
        type: "p",
        text: "Every time you buy a share, the trade and the actual exchange of money for ownership happen on different days. Since May 2024 that gap in the US is one business day — T+1. A large amount of financial machinery exists purely to carry the risk across that gap: collateral posted, margin held, procedures for when delivery fails. It works. It is also expensive, and the expense is ultimately paid by whoever is investing.",
      },
      {
        type: "p",
        text: "Technology now exists to make the trade and the settlement the same event, so that ownership and payment change hands simultaneously or not at all. That is a genuine improvement to how markets work, and it is not a cryptocurrency — it is a settlement method. But in the United States, no one can legally issue a mainstream share that settles this way at scale, because the law does not clearly say who regulates such an instrument or who may hold it for you.",
      },
      {
        type: "quote",
        text: "The CLARITY Act is not really a bill about crypto. It is a bill about whether American financial infrastructure is allowed to be upgraded, and by whom.",
      },
      {
        type: "p",
        text: "That is why banks care, why exchanges care, and why this is being fought over by people with no interest in digital assets as an investment.",
      },
      { type: "h2", text: "What actually happens on 15 September" },
      {
        type: "p",
        text: "The single most common error in coverage of this vote is treating it as a vote on the bill. It is not. Here is the full path from Tuesday to law.",
      },
      {
        type: "p",
        text: "The sequence runs like this. At 2:15 p.m. Eastern the Senate votes on cloture on the motion to proceed. Sixty of the hundred senators must vote yes. Republicans hold 53 seats, so at least seven Democrats have to join them.",
      },
      {
        type: "p",
        text: "If that vote fails, the bill stalls. It does not die — the text stays on the Legislative Calendar and can be taken up again — but it runs out of floor time for this year, and the Senate is expected to leave Washington around 17 September and not return until after the midterms.",
      },
      {
        type: "p",
        text: "If it succeeds, formal Senate debate opens. That is the beginning of the process rather than the end of it. Debate is followed by an amendment stage, which is where the stablecoin perimeter question gets fought explicitly and where each concession reshapes the coalition. Only after that does the Senate hold a passage vote — a separate vote from the one on 15 September, and the first one that actually passes anything.",
      },
      {
        type: "p",
        text: "A Senate text then has to be reconciled with the House version, H.R. 3633, which passed in July 2025. The reconciled bill goes to the President, and only a signature makes it law. Five further steps, each with its own failure mode, sit between Tuesday's vote and a statute.",
      },
      {
        type: "quote",
        text: "15 September is not the day the CLARITY Act becomes law. It is the day the Senate decides whether it is allowed to talk about it.",
      },
      {
        type: "p",
        text: "The Senate is expected to leave Washington around 17 September and not return until after the midterm elections. That is why a vote to open debate matters so much: without floor time immediately afterwards, even a successful cloture vote produces no further progress this year.",
      },
      { type: "h2", text: "SEC or CFTC: who regulates what" },
      {
        type: "p",
        text: "THE FIFTEEN-SECOND VERSION. The SEC regulates securities — investments in an enterprise, where you are relying on other people's efforts to make you money. The CFTC regulates commodities and their derivatives. The fight is that digital assets do not obviously sit in either box, and until a statute says which, the same asset can be argued into either agency's remit depending on who is arguing.",
      },
      {
        type: "p",
        text: "WHAT THE BILL WOULD DO. It creates a category called 'digital commodities' — assets whose value derives from the use of a decentralised blockchain protocol rather than from a company's managerial efforts — and gives the CFTC exclusive jurisdiction over their spot markets. The SEC keeps digital securities and primary-market fundraising for tokens that begin life as securities.",
      },
      {
        type: "p",
        text: "WHY THAT IS A BIGGER DEAL THAN IT SOUNDS. The CFTC's remit has historically been derivatives, not spot markets. Supervising cash markets in digital commodities would be a genuinely new function: registering and examining trading venues, running surveillance across venues that trade continuously, and setting customer-protection standards. That is a resourcing question as much as a legal one.",
      },
      {
        type: "p",
        text: "One correction worth making, because it appears constantly: the CFTC cannot pass the CLARITY Act, cannot amend it, and does not choose its own jurisdiction. Congress writes statutes; agencies implement them. Any argument that a regulator 'should pass' this bill is describing a system that does not exist.",
      },
      { type: "h2", text: "What tokenized equities actually are" },
      {
        type: "p",
        text: "A tokenized equity is a share in a company whose ownership is recorded as a transferable digital record rather than solely in the books of a central depository. The company, the claim on its earnings, the voting rights and the disclosure obligations are all unchanged. What changes is the plumbing.",
      },
      {
        type: "table",
        headers: ["", "A share today", "A tokenized share"],
        rows: [
          ["What you own", "A claim on the company", "The same claim on the same company"],
          ["Where ownership sits", "Broker's books, netted through a central depository", "A transferable record, held directly or by a custodian"],
          ["When settlement happens", "One business day after the trade (T+1)", "Potentially at the moment of the trade"],
          ["When you can trade", "Roughly 32.5 hours a week", "Potentially continuously"],
          ["Who regulates it", "The SEC. Settled law", "The SEC — but custody and transfer rules are the open question"],
        ],
        highlightCol: 2,
      },
      {
        type: "quote",
        text: "Tokenizing a share does not make the economic claim disappear. It changes how ownership is recorded and how transfer settles — which is precisely why the legal question is about custody and transfer, not about the share.",
      },
      {
        type: "p",
        text: "This is why the bill matters to equities at all. A tokenized share is still a security and the SEC still regulates it. The unresolved part is whether a regulated broker-dealer may custody it, and under what rules it may be transferred. That is the gap that keeps institutions out.",
      },
      { type: "h2", text: "What this means for you" },
      {
        type: "ul",
        items: [
          "If you hold crypto: the direct effect is on the exchanges and custodians you use, not on your coins. A statutory perimeter would tell venues which regulator examines them and under what customer-protection rules, which mostly shows up as clearer disclosures and more institutions willing to serve you.",
          "If you invest in shares: nothing changes immediately, and nothing about your existing holdings is affected. Over years, a clearer perimeter is what would allow settlement to shorten below T+1 for some instruments.",
          "If you run a bank: the live question is whether dollar flows move over tokenized deposits, which are your liability, or stablecoins, which are not. That perimeter is drawn by the GENIUS Act and by whatever CLARITY does to its edges.",
          "If you are building a fintech: the binding constraint today is not technical, it is that your compliance counsel cannot tell you which regulator governs an instrument. That is what a statute fixes, and why the calendar matters more than the technology.",
          "If you are a developer: nothing in this bill stops you writing settlement code, and the properties that code needs are the same either way. Build it now; the perimeter arrives later.",
          "If you are just curious: watch whether seven Democrats vote yes on Tuesday. That is the whole story for this year.",
        ],
      },
      { type: "h2", text: "The probability gap, and why most people read it wrong" },
      {
        type: "p",
        text: "Four numbers are circulating and are frequently quoted against each other as though they disagree. They do not: they answer different questions on different horizons. Three are PREDICTION-MARKET PRICES, which move continuously and are not forecasts; one is a published analyst ESTIMATE. All are stated with the date they were observed, and all will have moved by the time you read this.",
      },
      {
        type: "table",
        headers: ["Forecaster", "Question being priced", "Probability", "As of"],
        rows: [
          ["Polymarket", "CLARITY Act signed into law during calendar 2026", "~15%", "6 Sep 2026, >$14M volume"],
          ["Galaxy Research", "Enacted in 2026", "30%", "Aug 2026, cut from 50%"],
          ["Kalshi", "A qualifying market-structure law before 1 Jul 2027", "~30%", "Sep 2026"],
          ["Kalshi", "A qualifying market-structure law before 1 Jan 2028", "~50%", "Sep 2026"],
        ],
        highlightCol: 2,
      },
      {
        type: "p",
        text: "Polymarket's 2026 contract traded at about 82% in February. The probability fell to roughly 15% by September even though the legislative process had not formally collapsed: the bill was not voted down, and the committee process did not fail. The most obvious change over that period was the shrinking Senate calendar.",
      },
      {
        type: "quote",
        text: "A bill priced at 15% this year and 50% by early 2028 is not a bill the market thinks is wrong. It is a bill the market thinks is late.",
      },
      {
        type: "p",
        text: "Be careful with these numbers in either direction. A prediction market is a price, not a forecast with a confidence interval, and thin markets on procedural questions are easy to move. But the SHAPE across four independent forecasters — low near-term, materially higher over three years — is consistent, and that shape is the signal.",
      },
      { type: "h2", text: "What the CLARITY Act actually does, without the politics" },
      {
        type: "p",
        text: "Strip the framing and the bill does three structural things.",
      },
      {
        type: "ul",
        items: [
          "It allocates jurisdiction. The CFTC gets exclusive authority over spot markets in 'digital commodities' — assets whose value is tied to use of a decentralised protocol. The SEC keeps digital securities and primary-market fundraising for tokens that begin life as securities.",
          "It addresses broker-dealer custody of digital assets, which is the specific gap that keeps regulated intermediaries on the sidelines.",
          "It lets tokenized instruments, digital commodities and payment stablecoins sit under one coherent framework rather than three overlapping ones.",
        ],
      },
      {
        type: "p",
        text: "Note what is already settled and what is not. Payment stablecoins are no longer an open question at the federal level: the GENIUS Act was signed into law on 18 July 2025, requires full reserve backing, and bans issuers from paying any return to holders. That ban already exists. The stablecoin fight inside CLARITY is not about whether issuers may pay yield — federal law says they may not. It is about whether affiliates, exchanges and intermediaries can achieve the same economics by another route.",
      },
      {
        type: "p",
        text: "This matters because the fight is routinely described as 'banks versus stablecoin yield', which implies the yield is currently legal. It is not, at the issuer level. The dispute is over the perimeter of an existing prohibition, which is a narrower and more tractable disagreement than the headline suggests.",
      },
      { type: "h2", text: "Why this is a market-infrastructure bill, not a crypto bill" },
      {
        type: "p",
        text: "The most consequential thing about the CLARITY Act has little to do with whether Washington 'supports crypto'. It is whether the United States builds a legal framework capable of carrying tokenized securities, institutional custody and continuous settlement at scale — or whether that infrastructure matures somewhere else and America imports it later.",
      },
      {
        type: "p",
        text: "The evidence that this is an infrastructure question rather than a crypto question is that the infrastructure is already being built by institutions with no ideological interest in crypto at all. JPMorgan's Kinexys platform settles tokenized deposits at a reported average of more than $7 billion a day, has extended its deposit-token network to the Australian dollar, Hong Kong dollar, yen, renminbi and Singapore dollar, and launched a deposit token for institutional clients in November 2025 after testing with B2C2, Coinbase and Mastercard. JPMorgan and DBS have been exploring interoperability between their respective tokenized-deposit systems.",
      },
      {
        type: "p",
        text: "Reported cumulative volume figures for Kinexys vary widely across sources — we have seen both roughly $1.5 trillion and roughly $4 trillion cited in 2026 coverage, which is too wide a gap to treat as settled. The daily figure is more consistently reported. Either way the direction is unambiguous: the largest bank in the United States is running production tokenized settlement while the statute that would govern tokenized securities has not passed.",
      },
      {
        type: "quote",
        text: "Tokenization is not waiting for permission. It is waiting for a perimeter.",
      },
      { type: "h2", text: "Three layers of institutional tokenization" },
      {
        type: "p",
        text: "Most writing on this subject collapses three separate problems into one word. Separating them explains why progress looks stalled in one place and rapid in another.",
      },
      {
        type: "table",
        headers: ["Layer", "The question it answers", "Who decides", "Status, Sep 2026"],
        rows: [
          ["Legal", "Is this instrument a security, a commodity, or a payment stablecoin — and who regulates it?", "Congress, SEC, CFTC", "Unresolved for securities; settled for payment stablecoins under GENIUS"],
          ["Market structure", "Who may custody it, clear it, list it, and make markets in it?", "Regulators, exchanges, DTCC, broker-dealers", "Blocked on the legal layer"],
          ["Settlement engineering", "Can delivery and payment be made one atomic event that either happens or does not?", "Engineers", "Being built now, ahead of the other two"],
        ],
        highlightCol: 3,
      },
      {
        type: "p",
        text: "The layers are related by dependency, but they do not develop sequentially. Legal certainty is what unlocks the market-structure layer: a compliance committee cannot approve custody of an instrument whose regulator is undetermined. Engineering, by contrast, advances in parallel and is doing so now, because the properties it needs are the same whichever way the jurisdictional question is settled.",
      },
      {
        type: "p",
        text: "This is why 'the CLARITY Act is stalled' and 'tokenization is accelerating' are both true statements about September 2026. They describe different layers.",
      },
      { type: "h2", text: "What atomic settlement actually changes, and what it does not" },
      {
        type: "p",
        text: "THE SIMPLE VERSION. Atomic settlement means both sides of a trade complete together or neither does. You cannot end up having paid without receiving, or having delivered without being paid, because there is no moment in between for anything to go wrong.",
      },
      {
        type: "p",
        text: "THE INSTITUTIONAL VERSION follows, and it is less one-sided than advocates usually admit. The case for tokenized equities is generally made as a technology argument. It is really a settlement argument, and it is worth being precise about the mechanism.",
      },
      {
        type: "p",
        text: "US equity markets run roughly 32.5 hours a week of regular session. Settlement moved to T+1 in May 2024 — a genuine improvement, and still a model where a trade and its settlement occur on different days. Everything in that gap exists to carry risk across it: margin, clearing-fund contributions, buy-in procedures, and the operational tail of a failed delivery.",
      },
      {
        type: "p",
        text: "Atomic settlement collapses the gap to zero. Delivery and payment become one state transition that either commits or does not. There is no interval in which one leg has moved and the other has not. What that eliminates is precisely the settlement exposure created by the gap between delivery and payment, and the fails that follow from it. It does not eliminate margin requirements arising from market, counterparty, clearing or liquidity risk, which exist for reasons that have nothing to do with settlement timing. The gain is real and it is narrower than it is usually described.",
      },
      {
        type: "p",
        text: "Now the part most advocacy leaves out. Netting is not overhead — it is the reason a day of gross trading compresses into a small fraction of that gross in actual movements. A market that settles every trade atomically must fund every trade gross. The liquidity requirement rises, and it rises most exactly when markets are most stressed and funding is least available.",
      },
      {
        type: "ul",
        items: [
          "Atomic settlement removes settlement risk. It does not remove counterparty risk before the trade, market risk after it, or the need for someone to make prices.",
          "It removes fails. It does not remove the need for pre-funding, and pre-funding at gross is a real and recurring cost.",
          "It removes reconciliation between two ledgers. It does not remove the need for one ledger to be correct.",
          "It shortens the credit window. It does not eliminate credit — it relocates it to intraday liquidity provision.",
          "It enables continuous markets. It does not make continuous markets liquid; overnight and weekend liquidity is thin, and thin markets price worse.",
        ],
      },
      {
        type: "quote",
        text: "Anyone who tells you 24/7 atomic settlement is strictly better has not priced the liquidity.",
      },
      {
        type: "p",
        text: "The honest position is that atomic settlement trades a well-understood risk (settlement exposure across a day) for a less-understood one (gross intraday funding, continuously). That trade is probably worth making for many instruments and probably not for all of them, and the serious objections from market-structure professionals are versions of this point rather than hostility to the technology.",
      },
      { type: "h2", text: "The size of the prize, stated honestly" },
      {
        type: "p",
        text: "These forecasts are quoted loosely and often wrongly. Here is who said what, and when.",
      },
      {
        type: "table",
        headers: ["Source", "Forecast", "Published", "Note"],
        rows: [
          ["Citi Institute", "$5.5T by 2030", "June 2026", "Range $2.7T–$8.2T by adoption speed; baseline cited ~$17B"],
          ["BCG with Ripple", "$9.4T by 2030", "April 2025", "A downward revision of BCG's earlier estimate"],
          ["BCG, original", "$16.1T by 2030", "2022", "SUPERSEDED. Still widely quoted as current"],
          ["Observed RWA market", "~$27.7B", "April 2026", "Crossed $30B in 2026, roughly 300% year on year"],
        ],
        highlightCol: 1,
      },
      {
        type: "p",
        text: "The third row is the useful one. BCG's $16.1 trillion figure appears in most decks on this subject, and BCG themselves revised it to $9.4 trillion. Quoting the larger number in 2026 is a reliable indicator that a deck was assembled from other decks. For an audience that prices this professionally, the revision is a more informative fact than either forecast.",
      },
      {
        type: "p",
        text: "The defensible read: tokenized real-world assets are a real market of roughly $30 billion growing quickly, and every 2030 projection is a range spanning an order of magnitude. Point estimates to three significant figures are marketing.",
      },
      { type: "h2", text: "Why a bill with bipartisan support still struggles" },
      {
        type: "p",
        text: "'They just need to pass it' is not analysis. The mechanics are specific.",
      },
      {
        type: "ul",
        items: [
          "Cloture on the motion to proceed needs 60 votes. With 53 Republican seats, seven Democrats must cross before debate can even begin.",
          "That vote is the first of several. Success on 15 September opens floor debate and an amendment process, not passage.",
          "Amendments are where the stablecoin perimeter question gets fought explicitly. Every concession changes the coalition.",
          "A Senate text then has to be reconciled with the House's. Four to eight months of further work from here is a reasonable estimate.",
          "The chamber is expected to leave Washington around 17 September and not return until after the midterms. Floor time, not support, is the binding constraint.",
          "Committee dynamics have already done their work: the House passed the bill in July 2025 and Senate Banking reported it out with amendments on 1 June 2026. Neither happens to a bill without a constituency.",
        ],
      },
      {
        type: "p",
        text: "This is how a measure with majority support, committee approval and passage in one chamber ends up priced at 15% for the current year. Nothing about that number implies the underlying policy is unpopular.",
      },
      { type: "h2", text: "Why smart people oppose this" },
      {
        type: "p",
        text: "The strongest objections do not come from people who misunderstand the technology. They come from people who understand market structure well and have specific concerns.",
      },
      {
        type: "ul",
        items: [
          "Deposit competition. A stablecoin that behaves like a checking account but does not fund a loan book is a first-order threat to net interest margin and, at scale, to credit availability. Banks are fighting this as an existential question because for their business model it is one.",
          "Liquidity fragmentation. Tokenized equities trading alongside the same equities on existing venues can split the book. Two thin markets price worse than one deep one, and retail wears the spread.",
          "Loss of netting. Covered above; the most technically serious objection, and the least addressed by advocates.",
          "Operational resilience. A 24/7 market has no maintenance window. Every upgrade, migration and incident response happens in a live market, and no one has run one of these at national scale through a genuine crisis.",
          "Irreversibility. Atomic finality is the feature. It is also the reason an erroneous trade, a compromised key or a sanctioned counterparty cannot be unwound the way today's system permits.",
          "Investor protection. Continuous access to leveraged markets by retail investors at three in the morning is not obviously a consumer benefit.",
          "Regulatory arbitrage. A statute that draws a jurisdictional line also creates an incentive to structure instruments so they land on the preferred side of it.",
        ],
      },
      {
        type: "p",
        text: "These are good arguments. The response to most of them is not that they are wrong but that they are arguments about sequencing and scope — which instruments, which venues, which hours — rather than arguments against a legal perimeter existing at all. The status quo is not neutral: it is a choice to keep the perimeter undefined, which has its own costs and distributes them to whoever cannot afford the legal ambiguity.",
      },
      { type: "h2", text: "What this would mean for a bank like JPMorgan" },
      {
        type: "p",
        text: "We have no information about JPMorgan's position on the CLARITY Act and make no claim about it. What is verifiable is what the firm is already building, and that is more informative than a position statement would be.",
      },
      {
        type: "p",
        text: "Kinexys settles tokenized deposits in production at reported volumes above $7 billion daily, across an expanding set of currencies, with a deposit token launched for institutional clients in November 2025. Whatever JPMorgan's broader view of digital assets, that activity demonstrates programmable settlement being deployed at institutional scale today. Our own reading of why is straightforward, and is inference rather than reporting: moving value between ledgers on a shared programmable rail is cheaper and faster than correspondent banking, and that is an operating-cost argument rather than a view on any asset.",
      },
      {
        type: "p",
        text: "Which frames the strategic question for any large bank, independent of whether it likes crypto:",
      },
      {
        type: "ul",
        items: [
          "Custody. If tokenized securities become a regulated asset class, custody of them is a natural extension of an existing franchise — but only if the legal layer permits a broker-dealer to hold them.",
          "Tokenized deposits versus stablecoins. Both are dollar-denominated claims that move on programmable rails. One is a bank liability; the other is not. The perimeter drawn by GENIUS and CLARITY decides how much of that flow is intermediated by banks.",
          "Collateral mobility. Collateral that can move atomically between venues intraday is worth more than the same collateral trapped by settlement windows. This is a direct funding-cost argument.",
          "Treasury and repo. The largest near-term tokenization use case is not equities; it is short-dated government paper and repo, where settlement friction is most expensive relative to yield.",
          "Cross-border. Correspondent banking is the process the entire industry would replace if it could. Tokenized deposits are the incumbent-friendly version of that replacement.",
        ],
      },
      {
        type: "quote",
        text: "A bank does not have to be pro-crypto for tokenization to be strategically unavoidable. It only has to care where settlement infrastructure is heading — and it can read its own volume numbers.",
      },
      { type: "h2", text: "Why the CFTC has a direct institutional interest" },
      {
        type: "p",
        text: "A point of precision first, because getting this wrong is how a piece loses a regulatory reader in one sentence: the CFTC cannot pass the CLARITY Act, cannot amend it, and does not choose its own jurisdiction. Congress writes the statute; the agencies implement it. Any framing in which a regulator 'should pass' legislation is describing a system that does not exist.",
      },
      {
        type: "p",
        text: "What the bill would do is give the CFTC exclusive jurisdiction over spot markets in digital commodities — a class of authority the agency does not currently hold, since its remit is historically derivatives rather than spot. That is a material expansion, and it comes with obligations the agency would have to resource: registration and supervision of spot venues, market-surveillance capability across venues that trade continuously, and customer-protection standards in a cash market.",
      },
      {
        type: "p",
        text: "The institutional interest is therefore not ideological. It is that the current arrangement leaves the same asset arguable into either agency's remit depending on who is arguing, which is bad for the agency that ends up supervising it without a statutory mandate to do so, and worse for the one that does not know whether it should be. A clear perimeter is administratively easier to run than an ambiguous one, whichever side of it a given instrument lands on.",
      },
      { type: "h2", text: "What changes if the legal layer resolves" },
      {
        type: "p",
        text: "Separating the horizons matters, because most of the excitement attaches to effects that would take years and most of the actual near-term change is unglamorous.",
      },
      {
        type: "table",
        headers: ["Horizon", "What plausibly changes", "What does not"],
        rows: [
          ["Immediate", "Compliance committees can evaluate custody of digital assets against a statute rather than a guess. Registration paths become knowable.", "No new liquidity appears. No product launches on day one."],
          ["6–12 months", "Broker-dealer custody arrangements, first registered spot venues, institutional pilots move from sandbox to limited production.", "Retail-facing tokenized equities at scale. Settlement volumes remain small."],
          ["2–5 years", "Tokenized Treasuries and repo at meaningful scale; collateral mobility; selected equity venues with continuous settlement.", "Replacement of DTCC. The existing system is not going away, and the realistic outcome is parallel rails, not migration."],
        ],
      },
      {
        type: "p",
        text: "The most likely shape is not a transition but a coexistence: tokenized rails handling instruments where settlement friction is most expensive, alongside a netted, T+1 system that continues to handle the bulk of equity volume because netting remains cheaper for it.",
      },
      { type: "h2", text: "What happens if it does not pass" },
      {
        type: "p",
        text: "The failure case is not that tokenization stops. It is that it continues without the United States setting the terms. Some of this is evidenced, some is inference, and we mark which.",
      },
      {
        type: "ul",
        items: [
          "Evidenced: institutions are already building on tokenized rails under the current ambiguity — Kinexys is in production today. Absence of a statute has slowed the regulated-securities case, not the payments case.",
          "Evidenced: the EU has an operative framework in MiCA and several Asian jurisdictions have supervised tokenization regimes. Firms can and do route activity to where the perimeter is defined.",
          "Inference: a continued federal gap invites state-level frameworks, and a patchwork is more expensive to comply with than a single federal standard, which favours the largest incumbents.",
          "Inference: the cost of ambiguity falls hardest on firms that cannot afford to be wrong — which means it is a barrier to entry that protects incumbents, whatever its intent.",
          "Unknowable: whether capital 'flees'. That claim is made constantly, rarely with evidence, and we are not going to add to it.",
        ],
      },
      {
        type: "quote",
        text: "Regulatory uncertainty is not the absence of a rule. It is a rule that says: whoever can afford the lawyers gets to build.",
      },
      { type: "h2", text: "If regulation is the legal layer, settlement is the engineering layer" },
      {
        type: "p",
        text: "This is where we have to declare an interest: FurlPay builds settlement infrastructure, so we are not a neutral observer of the third layer. What follows is our engineering position rather than a product claim, and it is testable against our code — the [stablecoin settlement](/products/payments) and [agent payment](/products/x402) rails are documented, and the [wallet custody model](/products/wallet) is described in full.",
      },
      {
        type: "p",
        text: "The bet is straightforward. The legal layer will resolve on a timeline nobody controls. The engineering layer can be built now, and the properties it needs are the same whichever way the jurisdictional question is settled. Four of them do the work:",
      },
      {
        type: "ul",
        items: [
          "Atomicity by construction. If delivery and payment can fail independently, the system must carry machinery to reconcile those states, and that machinery is where errors accumulate. Atomicity makes the intermediate state impossible by construction rather than recoverable after the fact.",
          "Asset identity that carries its settlement domain. USDC on one chain and USDC on another are different claims with different failure modes. A ledger that collapses them into one balance is a ledger that will one day report money it cannot deliver.",
          "Authorization bound to exact bytes. Simulation, device attestation, user confirmation and the signature must all commit to the same canonical transaction. If they can commit to different ones, every individual control can pass while the wrong transaction is signed — and that is not a hypothetical failure mode, it is the ordinary one.",
          "Provider state is evidence, never truth. A counterparty saying a payment settled is a claim to be reconciled against your own ledger. Systems that treat an HTTP 200 as proof that money moved are the systems that discover the discrepancy from a customer.",
        ],
      },
      {
        type: "p",
        text: "None of those four require the CLARITY Act. All of them are presupposed by it. A statute that permits a broker-dealer to custody tokenized securities does not tell you how to make delivery-versus-payment atomic, how to keep two chains' balances distinct, or how to prove that what was authorised is what was signed. Those are engineering problems, and they are solvable today.",
      },
      {
        type: "quote",
        text: "The legal layer decides whether you are allowed to build. It never decides whether what you built is correct.",
      },
      { type: "h2", text: "15 September: what to actually watch" },
      {
        type: "ul",
        items: [
          "Whether cloture on the motion to proceed reaches 60. Seven Democratic votes is the number.",
          "If it fails, the margin. A 55-vote failure and a 45-vote failure are different bills in the next Congress.",
          "If it succeeds, whether floor time is actually allocated before the chamber leaves around 17 September. Cloture without floor time is a symbolic win.",
          "The amendment set on the stablecoin perimeter — specifically whether affiliate and exchange rewards are brought inside the GENIUS prohibition. That is where the banking objection gets fought on the record.",
          "Whether any Democratic co-sponsor language emerges before the vote. Public positions in the 72 hours prior are the best available signal on the seven.",
        ],
      },
      {
        type: "p",
        text: "We will update this article in place with the outcome rather than write a second one, so the record of what we expected sits beside what happened. Related reading: our [analysis of JPMorgan's Q2 2026 13F](/blog/what-jpmorgans-13f-actually-says), parsed from the original SEC filing, and [FurlPay Markets](/markets) for live pricing on the listed names in this piece.",
      },
      { type: "h2", text: "Timeline" },
      {
        type: "table",
        headers: ["Date", "Event"],
        rows: [
          ["18 Jul 2025", "GENIUS Act signed into law: federal stablecoin framework, full reserve backing, issuers barred from paying holders a return"],
          ["Jul 2025", "H.R. 3633 passes the House with bipartisan support"],
          ["May 2024", "US equities move to T+1 settlement"],
          ["1 Jun 2026", "Senate Banking Committee reports the bill out with amendments; placed on the Legislative Calendar"],
          ["Jun 2026", "Citi Institute publishes its Tokenization 2030 forecast"],
          ["8 Aug 2026", "Majority Leader files cloture, setting the September vote"],
          ["Aug 2026", "Galaxy Research cuts its 2026 enactment estimate from 50% to 30%"],
          ["15 Sep 2026", "Cloture vote on the motion to proceed, 2:15 p.m. ET"],
          ["~17 Sep 2026", "Senate expected to adjourn until after the midterms"],
          ["2027–28", "Kalshi prices ~30% by 1 Jul 2027 and ~50% by 1 Jan 2028 for a market-structure law"],
        ],
      },
      { type: "h2", text: "Conclusion" },
      {
        type: "p",
        text: "The CLARITY Act is not primarily a crypto bill and 15 September is not primarily a crypto vote. The question on the floor is whether the United States defines a perimeter for tokenized financial infrastructure, or leaves it undefined while that infrastructure gets built anyway — by banks, offshore, and in jurisdictions that have already answered the question.",
      },
      {
        type: "p",
        text: "The prediction markets are probably right that it does not happen this year. They are also, on a three-year horizon, close to a coin flip — a strange thing to say about a bill that has passed a chamber and cleared a committee. That gap between political timing and technical direction is the most useful fact in this debate, and it points somewhere unglamorous: the binding constraint is a legislative calendar, and calendars resolve.",
      },
      {
        type: "quote",
        text: "The CLARITY Act may run out of calendar in 2026. Tokenization will not. The political question is when Washington draws the perimeter; the engineering question is whether the infrastructure inside it is ready when they do. That is the part worth building now.",
      },
      { type: "h2", text: "Sources, and what we could not verify" },
      {
        type: "p",
        text: "Probabilities are as of 6 September 2026 and will move. Polymarket's 2026-enactment contract (~15%, >$14M volume); Kalshi's market-structure contracts (~30% before 1 July 2027, ~50% before 1 January 2028); Galaxy Research's published estimate (30%, revised down from 50% in August 2026).",
      },
      {
        type: "p",
        text: "Legislative status: House passage July 2025; Senate Banking Committee report 1 June 2026; cloture filed 8 August 2026; cloture motion ripening 2:15 p.m. ET 15 September 2026; 60-vote threshold against 53 Republican seats. GENIUS Act signed 18 July 2025. Market-size figures are attributed and dated in the tables above. Kinexys figures are from 2026 reporting on JPMorgan's platform.",
      },
      {
        type: "p",
        text: "Three things we deliberately did not publish. First, a widely circulated claim that Kalshi prices a 91% probability that the 15 September cloture vote occurs on schedule: Kalshi's published CLARITY markets price enactment, not whether a scheduled procedural vote takes place, and we could not locate that market. Second, BCG's $16.1 trillion figure as a current forecast, since BCG revised it to $9.4 trillion. Third, any characterisation of JPMorgan's position on the bill — we found no primary source stating one, and its production tokenization work is a matter of record regardless.",
      },
      {
        type: "p",
        text: "Where sources conflict we have said so rather than choosing: reported cumulative Kinexys settlement volume varies between roughly $1.5 trillion and roughly $4 trillion across 2026 coverage, and we do not know which is right.",
      },
      { type: "h2", text: "Frequently asked questions" },
      { type: "h2", text: "What is the CLARITY Act?" },
      {
        type: "p",
        text: "The Digital Asset Market Clarity Act (H.R. 3633) is US legislation that would define which digital assets are securities, which are commodities, and which are payment stablecoins, and allocate regulatory authority between the SEC and the CFTC accordingly. It passed the House of Representatives in July 2025 and was reported out of the Senate Banking Committee on 1 June 2026.",
      },
      { type: "h2", text: "What does the 15 September 2026 Senate vote decide?" },
      {
        type: "p",
        text: "It is a cloture vote on the motion to proceed, scheduled for 2:15 p.m. Eastern. It decides only whether the Senate may begin formal debate on the bill. It requires 60 of 100 votes. Republicans hold 53 seats, so at least seven Democrats must vote in favour for debate to open.",
      },
      { type: "h2", text: "Does the 15 September vote mean the CLARITY Act becomes law?" },
      {
        type: "p",
        text: "No. Cloture on the motion to proceed opens debate; it is not passage. After it would come floor debate, an amendment process, a Senate passage vote, reconciliation with the House text, and a presidential signature. Each is a separate step with its own failure mode.",
      },
      { type: "h2", text: "What authority would the CLARITY Act give the CFTC?" },
      {
        type: "p",
        text: "Exclusive jurisdiction over spot markets in digital commodities — assets whose value is tied to the use of a decentralised blockchain protocol. This is a material expansion, because the CFTC's existing remit is historically derivatives rather than spot markets. The CFTC cannot pass or amend the bill; Congress writes the statute and agencies implement it.",
      },
      { type: "h2", text: "What would the SEC keep under the CLARITY Act?" },
      {
        type: "p",
        text: "Authority over digital securities, and over primary-market fundraising for tokens that begin life as securities. The bill draws a perimeter between the two agencies rather than moving all digital assets to one of them.",
      },
      { type: "h2", text: "Does the CLARITY Act regulate stablecoins?" },
      {
        type: "p",
        text: "Payment stablecoins are already governed by separate federal law. The GENIUS Act was signed on 18 July 2025 and requires full reserve backing while barring issuers from paying any return to holders. The stablecoin dispute inside CLARITY is about whether affiliates, exchanges and intermediaries can deliver equivalent economics outside that prohibition — not about whether issuers may pay yield, which federal law already answers.",
      },
      { type: "h2", text: "What are digital commodities?" },
      {
        type: "p",
        text: "Under the CLARITY Act framework, digital commodities are assets whose value derives from the use of a decentralised blockchain protocol rather than from an enterprise's managerial efforts. Bitcoin and Ether are the standard examples. The classification matters because it determines which agency supervises the spot market.",
      },
      { type: "h2", text: "What are tokenized equities?" },
      {
        type: "p",
        text: "Tokenized equities are shares in a company represented as transferable records on a blockchain rather than solely in a central securities depository's books. The instrument is the same equity claim; what changes is how ownership is recorded and how transfer settles.",
      },
      { type: "h2", text: "What is atomic settlement?" },
      {
        type: "p",
        text: "Atomic settlement means delivery of an asset and payment for it occur as a single state transition that either commits entirely or does not occur at all. There is no interval in which one side has moved and the other has not, which removes the settlement exposure that exists between trade and settlement in a T+1 system.",
      },
      { type: "h2", text: "Does atomic settlement eliminate settlement risk?" },
      {
        type: "p",
        text: "It eliminates the settlement exposure created by the gap between delivery and payment, and the fails that follow from it. It does not eliminate market risk, counterparty risk before the trade, clearing risk, or margin requirements arising from those. It also removes netting, so every trade must be funded gross — a real and recurring liquidity cost that rises precisely when funding is least available.",
      },
      { type: "h2", text: "Does atomic settlement replace T+1?" },
      {
        type: "p",
        text: "Not automatically, and probably not entirely. US equities moved to T+1 in May 2024. Netting is why a day of gross trading compresses into a small fraction of that gross in actual movements, and netting remains cheaper for high-volume equity flow. The realistic outcome is parallel rails, with tokenized settlement used where settlement friction is most expensive relative to yield — short-dated government paper and repo before equities.",
      },
      { type: "h2", text: "When could the CLARITY Act become law?" },
      {
        type: "p",
        text: "This is uncertain and should not be stated as a forecast. As of 6 September 2026, Polymarket priced roughly 15% for enactment during calendar 2026; Kalshi priced roughly 30% for a qualifying market-structure law before 1 July 2027 and roughly 50% before 1 January 2028; Galaxy Research published a 30% estimate for 2026, revised down from 50% in August 2026. These are market prices and analyst estimates, not facts, and they move.",
      },
      { type: "h2", text: "What is JPMorgan Kinexys and why does it matter here?" },
      {
        type: "p",
        text: "Kinexys is JPMorgan's blockchain settlement platform, reported in 2026 to settle tokenized deposits at an average of more than $7 billion a day across an expanding set of currencies, with a deposit token launched for institutional clients in November 2025. It matters because it shows institutional tokenized settlement operating in production while the statute that would govern tokenized securities has not passed. Reported cumulative volume figures vary widely across sources and should be treated with caution.",
      },
      { type: "h2", text: "How large is the tokenized real-world asset market?" },
      {
        type: "p",
        text: "Roughly $27.7 billion as of April 2026, having crossed $30 billion during 2026 on approximately 300% year-on-year growth. Forecasts for 2030 span an order of magnitude: Citi published $5.5 trillion in June 2026 with a range of $2.7–$8.2 trillion. BCG's widely quoted $16.1 trillion figure is superseded — BCG revised it to $9.4 trillion in April 2025.",
      },
    ],
  },
  // Markets research — the JPMorgan Q2 2026 13F reference piece. Restructured
  // 2026-09-02 to lead with the filing rather than with our own corrections,
  // which now sit in a dated editor's note and a Corrections section at the end
  // where a reader expects them.
  //
  // Every figure was parsed from Information_Table_06.30.2026.xml twice — once
  // with a namespace-tolerant pattern reader, once with a streaming XML parser —
  // and both reconcile to the filer's stated 34,064 entries and
  // $1,807,041,234,839 exactly. Do not edit a number here without re-running
  // that reconciliation. The corrections list is part of the record: append to
  // it, never quietly rewrite a figure it names.
  {
    slug: "what-jpmorgans-13f-actually-says",
    title: "JPMorgan 13F Q2 2026: What the SEC Filing Actually Shows",
    excerpt:
      "JPMorgan reported $1,807,041,234,839 across 34,064 information-table rows for the quarter ended 30 June 2026. We parsed the original SEC XML twice and reconciled it to the dollar. Here is what the filing shows on the iShares Ethereum and Bitcoin trusts, Strategy, the bitcoin miners and the semiconductor names — and why the same filing produces different position counts, share totals and rankings depending on how the rows are read.",
    category: "engineering",
    date: "2026-09-02",
    readMins: 18,
    author: "Ashutosh Kumar Singh",
    cover: "/blog/jpmorgan-13f.svg",
    body: [
      {
        type: "p",
        text: `On 12 August 2026, JPMorgan Chase & Co. filed its Form 13F-HR for the quarter ended 30 June. The information table runs to 19,472,014 bytes and 34,064 rows, and reports securities worth $1,807,041,234,839. It is a public document, and the numbers in it are not in dispute.`,
      },
      {
        type: "p",
        text: `What is in dispute is what those numbers mean. Depending on how the rows are counted, the same filing contains 34,064 positions, or 7,720, or 4,737. Depending on how one field is read, JPMorgan holds 3.8 million shares of Strategy Inc or 630,709. Depending on whether you match securities by name or by identifier, one bitcoin miner in the filing has no position at all. Every one of those readings is arithmetically defensible and only one of each pair is correct.`,
      },
      {
        type: "p",
        text: `This is what the filing reports, parsed from the original XML rather than from a summary of it, with the aggregation choices stated wherever they change an answer.`,
      },
      { type: "h2", text: "The primary document" },
      {
        type: "table",
        headers: ["Field", "Value"],
        rows: [
          ["Filer", "JPMORGAN CHASE & CO"],
          ["CIK", "0000019617"],
          ["Form", "13F-HR"],
          ["Filed", "12 August 2026"],
          ["Period of report", "30 June 2026"],
          ["Accession", "0000019617-26-000325"],
          ["Information table", "Information_Table_06.30.2026.xml, 19,472,014 bytes"],
          ["Entries reported by filer", "34,064"],
          ["Entries we parsed", "34,064"],
          ["Value reported by filer", "$1,807,041,234,839"],
          ["Value we summed", "$1,807,041,234,839"],
          ["Confidential omissions", "None (isConfidentialOmitted false)"],
          ["Other included managers", "17"],
        ],
      },
      {
        type: "p",
        text: `The parse reconciles exactly — same entry count, same total to the dollar. We then discarded that parser and did it again with a streaming XML parser rather than pattern matching, written independently. It returned the same 34,064 rows, the same $1,807,041,234,839, and the same distinct-CUSIP counts. Reconciliation against the filer's own stated totals is the minimum bar before quoting anything from a filing, and it is the step most summaries skip.`,
      },
      {
        type: "code",
        lang: "bash",
        code: `# The whole filing. No key, no vendor. The SEC requires a real
# User-Agent with a contact address and refuses anonymous traffic.
BASE=https://www.sec.gov/Archives/edgar/data/19617/000001961726000325
curl -H "User-Agent: your-name your@email" $BASE/primary_doc.xml
curl -H "User-Agent: your-name your@email" \\
     -o infotable.xml "$BASE/Information_Table_06.30.2026.xml"`,
      },
      { type: "h2", text: "34,064 entries is not 34,064 positions" },
      {
        type: "p",
        text: `A Form 13F information table is a list of rows, not a list of holdings. The SEC requires separate reporting by investment discretion and by other included managers, so one position held across several mandates appears as several rows. Counting the same filing six ways gives six answers, and all six are reproducible from the document:`,
      },
      {
        type: "table",
        headers: ["What you count", "Count"],
        rows: [
          ["Raw information-table rows (the filer's own entry total)", "34,064"],
          ["Distinct CUSIPs", "7,720"],
          ["Distinct CUSIPs appearing on ordinary share rows", "6,818"],
          ["Distinct issuer-name strings", "6,474"],
          ["Distinct issuer name + title of class", "7,251"],
          ["Distinct issuers by six-character CUSIP prefix", "4,737"],
        ],
      },
      {
        type: "p",
        text: `Databases that describe this filing as roughly 7,720 positions are counting distinct CUSIPs. That is a reasonable definition. So is 4,737, which folds an issuer's option CUSIPs onto the security they are written on. So is 34,064. "How many positions does JPMorgan report?" has no answer until someone says which of these they mean.`,
      },
      {
        type: "quote",
        text: `Different aggregation methodologies are not competing claims about reality. They become misleading only when the methodology is not stated — which is nearly always.`,
      },
      { type: "h2", text: "How the filing reports options" },
      {
        type: "p",
        text: `This is the single easiest place to misread a 13F, in either direction. The SEC's Form 13F FAQ, answering what belongs in Column 5, is explicit: most of the column entries for an option "refer to the underlying security, rather than to the option itself", covering Columns 1 through 5 and 7 through 8. The option is identified by the PUT or CALL designation alone. The value, the amount and the class all describe the underlying.`,
      },
      {
        type: "p",
        text: `Two fields settle it before any arithmetic. Option rows carry titleOfClass "OPTION" and a distinct CUSIP — the iShares Ethereum Trust's shares are 46438R105 while its calls and puts are 46438R905 and 46438R955 — and they carry sshPrnamtType "SH". The type field on an option row says shares.`,
      },
      {
        type: "p",
        text: `The arithmetic agrees. Divide reported value by reported amount on a share row, then on the same issuer's option rows. If option rows were denominated in contracts the two would differ by a factor of about 100. They do not differ at all:`,
      },
      {
        type: "table",
        headers: ["Issuer", "Share rows: value / amount", "Call rows", "Put rows"],
        rows: [
          ["NVIDIA", "$194.97", "$194.97", "$194.97"],
          ["Apple", "$281.74", "$281.74", "$281.74"],
          ["Invesco QQQ Trust", "$724.08", "$724.08", "$724.08"],
          ["iShares Bitcoin Trust", "$34.18", "$34.18", "$34.18"],
          ["iShares Ethereum Trust", "$12.24", "$12.24", "$12.24"],
        ],
      },
      {
        type: "p",
        text: `Across the filing, 869 issuers carry both share rows and option rows. In 729 the implied prices agree within two percent, and in none of them — zero out of 869 — is the ratio anywhere near 100. So an option row reads: this manager held options over this many shares of this security, and those shares were worth this much at quarter end. It is not a count of contracts, not a statement of what the options cost, and not a share position.`,
      },
      {
        type: "p",
        text: `For scale, 466 call rows carry $37,970,606,604 and 473 put rows carry $56,739,111,688, together about 5.2 percent of the filing's reported value. Two constraints from the SEC's guidance matter for anyone tempted to net them: written options are not reportable at all, so every option row is a long position, and short equity positions never appear either. A 13F cannot show a net book, and no arithmetic on it will produce one.`,
      },
      { type: "h2", text: "A third row type that is neither stock nor options" },
      {
        type: "p",
        text: `Splitting rows into shares and options is still not enough, because the information table also carries convertible debt. The field that distinguishes it is sshPrnamtType: SH for a share count, PRN for a principal amount in dollars. A bond row is not an option, so any test that asks only "is this an option?" passes it into the share bucket, where a principal amount is added to a count of shares.`,
      },
      {
        type: "p",
        text: `This filing carries 447 such rows worth $1,724,173,261 — convertible debt of Western Digital, Alibaba, Microchip, On Semiconductor and others. It is the difference between two totals that look interchangeable: non-option rows total $1,712,331,516,547, while genuine share rows total $1,710,607,343,286.`,
      },
      {
        type: "p",
        text: `Classified properly, every row in the filing falls into exactly one of four buckets, and the four sum to the filer's own stated total:`,
      },
      {
        type: "table",
        headers: ["Bucket", "Rows", "Reported value"],
        rows: [
          ["Ordinary shares (SH, non-option)", "32,678", "$1,710,607,343,286"],
          ["Convertible debt (PRN)", "447", "$1,724,173,261"],
          ["Calls, over underlying shares", "466", "$37,970,606,604"],
          ["Puts, over underlying shares", "473", "$56,739,111,688"],
          ["Total", "34,064", "$1,807,041,234,839"],
        ],
      },
      { type: "h2", text: "The largest lines, counted two ways" },
      {
        type: "p",
        text: `Ranked by ordinary share value, aggregating each issuer by its six-character CUSIP prefix:`,
      },
      {
        type: "table",
        headers: ["#", "Security", "Ordinary shares", "Reported value", "% of share total"],
        rows: [
          ["1", "NVIDIA", "449,404,578", "$87.62B", "5.12%"],
          ["2", "Alphabet (all classes)", "230,990,188", "$80.93B", "4.73%"],
          ["3", "Apple", "228,762,008", "$64.45B", "3.76%"],
          ["4", "JPM Diversified Return US MC Equity", "726,063,576", "$53.35B", "3.12%"],
          ["5", "Microsoft", "135,173,516", "$49.82B", "2.91%"],
          ["6", "iShares S&P Small-Cap 600 Growth", "286,317,285", "$48.55B", "2.84%"],
          ["7", "Amazon", "167,979,147", "$40.34B", "2.36%"],
          ["8", "Broadcom", "95,016,148", "$35.39B", "2.07%"],
          ["9", "SPDR S&P 500 ETF", "47,650,227", "$35.31B", "2.06%"],
          ["10", "Micron Technology", "25,836,011", "$29.59B", "1.73%"],
        ],
      },
      {
        type: "p",
        text: `Four of those ten are funds rather than operating companies, and one is JPMorgan's own product. Restricting to operating companies gives a different list: NVIDIA, Alphabet, Apple, Microsoft, Amazon, Broadcom, Micron, then Meta at $25.85 billion, AMD at $21.75 billion and Lam Research at $18.62 billion. Neither ranking is more correct — they answer different questions, and publishing one while implying the other is how "largest holding" claims go wrong.`,
      },
      {
        type: "p",
        text: `Alphabet is aggregated across share classes here. Splitting Class A from Class C would move it down the table. We state the choice rather than leave a reader to discover it by disagreeing with a different site.`,
      },
      { type: "h2", text: "The iShares Ethereum Trust position" },
      {
        type: "p",
        text: `A widely circulated figure put JPMorgan at roughly 1.17 million shares of the iShares Ethereum Trust, worth about $14.3 million, up around fourfold on the quarter. The filing supports all three parts of that.`,
      },
      {
        type: "table",
        headers: ["Row type", "Amount", "Reported value"],
        rows: [
          ["Ordinary shares (three rows: 156 + 1,167,975 + 1,300)", "1,169,431", "$14,313,835"],
          ["Call, over underlying shares", "600,000", "$7,344,000"],
          ["Put, over underlying shares", "600,000", "$7,344,000"],
        ],
      },
      {
        type: "p",
        text: `The three share rows are split by investment discretion — one OTR row of 156 shares and two DFND rows — which is why they appear separately rather than as one line. JPMorgan's Q1 2026 filing, accession 0000019617-26-000225 for the period ended 31 March, reports 266,734 ordinary shares worth $4,073,028. The increase to 1,169,431 shares is 902,697 shares, or 338 percent.`,
      },
      {
        type: "p",
        text: `One detail from those rows is worth keeping. The share rows name the issuer "ISHARES ETHEREUM TRUST ETF"; the option rows name it "ISHARES ETHEREUM TR". The same security, two spellings, in the same filing. Anything matching on issuer name rather than identifier splits the position without reporting an error.`,
      },
      {
        type: "p",
        text: `What the filing does not establish is why the position grew. It shows a reported position increasing. It does not identify that position as proprietary, as client facilitation, as a hedge or as a directional view, and nothing in the document distinguishes between them. The same restraint applies to the equal call and put lines: 600,000 underlying shares on each side is consistent with a hedged or non-directional structure, and consistent with several other things too.`,
      },
      { type: "h2", text: "The iShares Bitcoin Trust position" },
      {
        type: "table",
        headers: ["iShares Bitcoin Trust", "Q1 2026 (31 Mar)", "Q2 2026 (30 Jun)", "Change"],
        rows: [
          ["Ordinary shares", "8,302,691", "10,407,635", "+2,104,944 (+25.4%)"],
          ["Reported value of shares", "$312,845,416", "$355,732,983", "+13.7%"],
          ["Calls, underlying shares", "3,775,000", "3,945,000", "+170,000"],
          ["Puts, underlying shares", "4,756,400", "3,495,800", "−1,260,600"],
        ],
      },
      {
        type: "p",
        text: `The ordinary share count rose about 25 percent quarter over quarter and the put line fell by more than a quarter. Both are computed from two filings and both are facts about what was reported. The reported value rose less than the share count did because the ETF's quarter-end price fell — a reminder that a change in reported value mixes a change in position with a change in price.`,
      },
      { type: "h2", text: "The 33-share Solana position" },
      {
        type: "p",
        text: `A circulating claim put JPMorgan at roughly 47,500 shares of the Bitwise Solana Staking ETF. The Q2 filing reports 33 shares, worth $340. The prior quarter explains the gap: at 31 March the filing reports 47,460 shares, worth $523,484. The claim was not invented. It was a quarter out of date, which is the most common failure in filing-derived data and looks identical to fabrication from the outside.`,
      },
      {
        type: "p",
        text: `The ticker in that claim is a separate problem. The fund trades as BSOL. "SOL" is not a US equity ticker at all — it is the token the fund tracks.`,
      },
      { type: "h2", text: "Strategy Inc: why three numbers are not one position" },
      {
        type: "table",
        headers: ["Strategy Inc (MSTR)", "Q1 2026", "Q2 2026"],
        rows: [
          ["Common and preferred shares", "567,804", "630,709"],
          ["Reported value of those shares", "$68,740,805", "$58,244,442"],
          ["Convertible debt, principal", "$6,543,000", "$3,200,000"],
          ["Reported value of that debt", "$6,565,367", "$2,817,868"],
          ["Calls, underlying shares", "90,000", "338,000"],
          ["Puts, underlying shares", "207,100", "715,700"],
        ],
      },
      {
        type: "p",
        text: `Nineteen rows sit under the CUSIP prefix 594972: eleven of common stock, two of a convertible preferred series, four of convertible notes, and one each of calls and puts. The equity rows total 630,709 shares — 624,387 of common under CUSIP 594972408 plus 6,322 of preferred. The note rows are a principal amount of $3,200,000. Adding the two gives 3,830,709, a figure that is not a share count of anything, and it is the number that has circulated most widely.`,
      },
      {
        type: "p",
        text: `Read by row type, the equity position rose over the quarter while the convertible principal roughly halved. A summary reporting a single "MSTR position" has to choose one of these to be the number, and whichever it chooses will be wrong for some readers.`,
      },
      { type: "h2", text: "The crypto-linked names, ordinary share rows only" },
      {
        type: "table",
        headers: ["Security", "Ordinary shares", "Reported value"],
        rows: [
          ["Robinhood Markets", "15,803,996", "$1,609,321,182"],
          ["iShares Bitcoin Trust", "10,407,635", "$355,732,983"],
          ["Coinbase Global", "11,148,552", "$220,486,248"],
          ["IREN Limited (common, CUSIP Q4982L109)", "2,699,785", "$123,947,214"],
          ["Strategy Inc (common and preferred)", "630,709", "$58,244,442"],
          ["Riot Platforms", "1,557,533", "$36,938,390"],
          ["MARA Holdings", "3,495,920", "$36,077,799"],
          ["CleanSpark", "1,973,744", "$26,127,126"],
          ["Cipher Digital", "692,770", "$17,583,910"],
          ["iShares Ethereum Trust", "1,169,431", "$14,313,835"],
          ["Grayscale Bitcoin Mini Trust", "145,717", "$3,889,201"],
          ["Fidelity Wise Origin Bitcoin", "4,079", "$214,266"],
          ["Grayscale Bitcoin Trust", "448", "$20,952"],
          ["Bitwise Solana Staking ETF", "33", "$340"],
        ],
      },
      {
        type: "p",
        text: `Robinhood is the largest of these by a wide margin. Grayscale's original Bitcoin Trust, the fund whose outflows are written about constantly, is a 448-share line worth $20,952 — a rounding error inside a $1.8 trillion filing.`,
      },
      { type: "h2", text: "Why a ticker is not a security identity" },
      {
        type: "p",
        text: `IREN is the sharpest illustration in this filing. Searching the issuer name for "IREN" returns 19 rows across three different companies and three instrument types. The miner's common stock is 12 rows under CUSIP Q4982L109 — 2,699,785 shares, $123,947,214. Its options are two rows under Q4982L909 and Q4982L959, over 788,100 underlying shares. Three further rows are convertible bonds under two entirely different CUSIPs, 46270CAB5 and 46270CAD1, carrying $4,080,452 of value over $1,294,000 of principal. The remaining rows belong to IRENIC ACQUISITION CORP and YIREN DIGITAL LTD, which are unrelated companies.`,
      },
      {
        type: "p",
        text: `IREN also marks the limit of the method used here. Grouping by the first six CUSIP characters folds an issuer's options onto its stock, but IREN's shares carry a CINS beginning Q4982L — the identifier range for foreign issuers — while its US-registered notes begin 46270C. Same company, two unrelated prefixes, so this aggregation reports them separately. That is a defensible choice and a visible one; it is not a complete answer to corporate identity, and it is better to say where a method stops than to imply it does not.`,
      },
      {
        type: "p",
        text: `Cipher makes the same point from the other direction. The company usually called Cipher Mining is filed as CIPHER DIGITAL INC. A search for "CIPHER MINING" returns nothing and produces a confident false negative on a $17,583,910 position sitting under CUSIP 17253J106.`,
      },
      { type: "h2", text: "Where circulating summaries fail against the filing" },
      {
        type: "p",
        text: `The semiconductor figure. A widely repeated claim is that Taiwan Semiconductor, AMD, Qualcomm and Applied Materials together account for "$240+ billion". Ordinary share rows in the filing: AMD $21,746,429,376, Taiwan Semiconductor $10,844,709,209, Qualcomm $1,560,803,624 — $34,151,942,209 in total. Applied Materials does not appear in the filing at all, under any CUSIP or name variant. Adding every option row for the three that are present raises the total only to about $37.4 billion.`,
      },
      {
        type: "p",
        text: `The Berkshire ranking. Berkshire Hathaway appears at $6.50 billion of ordinary shares and is not the largest non-technology line by any reading. Johnson & Johnson at $15.07 billion, Mastercard at $14.39 billion and AbbVie at $12.17 billion are all larger operating companies, and several fund vehicles are larger still.`,
      },
      { type: "h2", text: "What the $1.807 trillion is, and is not" },
      {
        type: "p",
        text: `It is not JPMorgan's portfolio in the sense a reader naturally imports. The cover page lists 17 other included managers, which under the SEC's definitions makes this a combination report — a sum across a structure of affiliated managers, not one desk's book. The filing reports securities over which those managers exercised investment discretion. It does not distinguish proprietary capital from client assets, and it does not say why any position exists.`,
      },
      {
        type: "p",
        text: `Nor is it a complete picture of anything. Section 13(f) securities are principally US exchange-traded equities and ETFs, with certain convertible debt, options and warrants; short positions, cash, most debt and non-US listings fall outside the report. Written options are excluded by rule. The document describes holdings as of 30 June 2026 and was filed on 12 August, generally within the 45 days managers are given. The SEC does not verify these filings, so the correct phrasing downstream is "the filing reports", never "the SEC confirms".`,
      },
      { type: "h2", text: "JPMorgan's own stock, measured separately" },
      {
        type: "p",
        text: `These figures are market data and a share count from a 10-Q, not part of the 13F, and they carry their own timestamps.`,
      },
      {
        type: "table",
        headers: ["Metric", "Measured", "Basis"],
        rows: [
          ["Shares outstanding", "2,658,186,195", "dei tag, 10-Q for the quarter ended 30 Jun 2026, filed 6 Aug 2026"],
          ["Close, 1 Sep 2026", "$354.95", "consolidated tape"],
          ["Market capitalisation", "$943.5B", "computed: close × shares outstanding"],
          ["Highest intraday, trailing 2y", "$366.50 on 13 Aug 2026", "daily bars"],
          ["Highest close, trailing 2y", "$365.18 on 12 Aug 2026", "daily bars"],
          ["3-month return", "+17.94%", "computed from 2 Jun 2026 close of $300.96"],
          ["1-year return", "+17.76%", "computed from 29 Aug 2025 close of $301.42"],
        ],
      },
      {
        type: "p",
        text: `Return figures depend entirely on the start date, which is why the basis is printed beside them. A summary quoting +20.6% and +19.2% is not necessarily wrong; it may be measuring from different days. Without the basis, neither number can be checked.`,
      },
      { type: "h2", text: "Reported, computed, normalized, inferred" },
      {
        type: "p",
        text: `The discipline that prevents most filing-derived errors is labelling which kind of statement a number is.`,
      },
      {
        type: "ul",
        items: [
          "REPORTED — present in the filing. The filing reports 1,169,431 ordinary shares of the iShares Ethereum Trust.",
          "COMPUTED — arithmetic over reported values, with the inputs named. That is 338% above the 266,734 shares in the prior quarter's filing.",
          "NORMALIZED — the result of an aggregation choice. Alphabet at $80.93B combines share classes under one CUSIP prefix; splitting them gives a different table.",
          "INFERRED — an interpretation the filing permits but does not establish. Equal call and put lines are consistent with a hedged structure.",
          "NOT ESTABLISHED — what the document cannot support. The filing does not show whether any position is proprietary, facilitation, hedging or a directional view.",
        ],
      },
      {
        type: "p",
        text: `Almost every wrong headline about a 13F is a claim that moved from the last category into the first without anyone noticing. It does not require bad faith, only an unlabelled number.`,
      },
      { type: "h2", text: "How to audit a 13F yourself" },
      {
        type: "ul",
        items: [
          "Fetch data.sec.gov/submissions/CIK##########.json for the filing index. No API key; a descriptive User-Agent with a contact address is required.",
          "Take the 13F-HR, not the 13F-NT — a notice means another manager reports the holdings and carries no information table.",
          "Check whether a later 13F-HR/A exists, and read its amendment type. A restatement replaces the filing; an amendment adding new holdings contains only the added rows.",
          "Parse with a namespace-tolerant reader. Filers use ns1, n1 or no prefix, and a parser that assumes one shape returns zero rows for the others.",
          "Reconcile your row count and your sum against the filer's own tableEntryTotal and tableValueTotal before quoting anything.",
          "Classify on sshPrnamtType as well as putCall, so convertible debt reported as a principal amount never reaches a share count.",
          "Remember that an option row's amount and value describe the underlying security, and that written options are not reported at all.",
          "Aggregate on CUSIP, not on issuer name, and state which aggregation your counts use.",
          "Compare against the prior quarter before calling a number new, missing or wrong.",
        ],
      },
      { type: "h2", text: "What this changed in our own systems" },
      {
        type: "p",
        text: `Our 13F parser now labels option rows as underlying shares rather than contracts, and the field names changed with them. Convertible debt aggregates into its own principal and value fields and is excluded from share totals. Reconciliation against the filer's stated totals runs before any figure is served, with a tolerance of half a dollar per entry — the arithmetic bound on the filer's own rounding, tight enough to still fail a dropped row. A test asserts that the four buckets sum to the reported total, which is the check that catches a row miscounted from one bucket into another.`,
      },
      {
        type: "p",
        text: `Securities are matched by CUSIP, never by issuer name, because issuer names are how "RIOT" matches MARRIOTT and "MARA" matches MARATHON PETROLEUM. Nothing in our catalog links a 13F row to a tradable symbol: a CUSIP-to-ticker map is something we do not have and will not approximate with string comparison.`,
      },
      {
        type: "p",
        text: `The naming problem outlasts this filing. BTC is a real, tradable US ticker — the Grayscale Bitcoin Mini Trust, which appears in this filing at 145,717 shares — and it is also what people mean when they type three letters into a payments app. XRP is both a token and an ETF. Our catalog resolves a bare ticker towards the listed security, a rule added after STX resolved to Stacks rather than Seagate. But that map is what the order endpoint books against, so cataloguing the Grayscale fund under BTC would have quietly redefined what "buy BTC" executes. Both were left out, and a test fails if anyone adds the row.`,
      },
      {
        type: "code",
        lang: "typescript",
        code: `// The tripwire, not the comment, is what protects this.
it("BTC still resolves to the coin, not an ETF", () => {
  expect(bySymbol.get("BTC")?.kind).toBe("crypto");
  expect(byKindSymbol.has("etf:BTC")).toBe(false);
});`,
      },
      { type: "h2", text: "Editor's note and corrections" },
      {
        type: "p",
        text: `This article was substantially revised on 2 September 2026. An earlier version, published the same day under a different headline, reported several figures incorrectly. None of the errors came from the filing or from extracting it — the row count and total reconciled to the dollar on the first parse. All of them came from how correctly extracted rows were then classified. The corrections are listed here rather than quietly amended.`,
      },
      {
        type: "p",
        text: `It stated that JPMorgan held no shares of the iShares Ethereum Trust, and that a circulating figure of about 1.17 million shares had been produced by reading option contracts as stock. The filing reports 1,169,431 ordinary shares worth $14,313,835. The circulating figure was correct and the error was ours.`,
      },
      {
        type: "p",
        text: `It stated that the Invesco QQQ Trust had no share line. The filing contains eleven ordinary share rows totalling 2,912,061 shares and $2,108,565,901, alongside the option lines.`,
      },
      {
        type: "p",
        text: `It described an option row's amount as a count of contracts. Per the SEC's Form 13F guidance and confirmed across 869 issuer comparisons in this filing, the amount and value on an option row describe the underlying security.`,
      },
      {
        type: "p",
        text: `It reported Strategy Inc at 3,830,709 shares and dismissed a circulating claim of "624,387+ shares" as understating the position roughly sixfold. Both were wrong for the same reason: 3,830,709 is 630,709 shares of stock plus $3,200,000 of convertible note principal, and 624,387 is exactly the common-stock line. It also said the position had halved over the quarter; the equity rose, and it was the note principal that fell.`,
      },
      {
        type: "p",
        text: `A revision reported IREN Limited at 3,993,785 shares and $128,027,666, again adding bond principal to a share count. The common stock is 2,699,785 shares worth $123,947,214, with the debt reported separately. The same revision described $1,712,331,516,547 as the total of ordinary share lines; that is the total of all non-option rows, and share rows alone total $1,710,607,343,286.`,
      },
      {
        type: "p",
        text: `It published a "ten largest positions" table that omitted two fund vehicles ranking fourth and sixth, characterised a distinct-CUSIP count of about 7,720 as an error rather than a valid aggregation, and reported Cipher Mining as absent from the filing when the issuer is filed as CIPHER DIGITAL INC and holds $17,583,910.`,
      },
      { type: "h2", text: "The audit, claim by claim" },
      {
        type: "table",
        headers: ["Claim", "What the filing shows", "Status"],
        rows: [
          ["Total $1,807,041,234,839", "Matches, to the dollar (reported)", "Confirmed"],
          ["34,064 entries", "Matches the filer's own entry total (reported)", "Confirmed"],
          ["\"7,712 positions\" is wrong", "7,720 distinct CUSIPs — a valid count, not an error (normalized)", "Corrected"],
          ["Zero ETHA shares", "1,169,431 shares, $14,313,835 across three rows (reported)", "False"],
          ["ETHA quadrupled over the quarter", "266,734 → 1,169,431 shares, +338% (computed)", "Confirmed"],
          ["QQQ has no share line", "11 rows, 2,912,061 shares, $2,108,565,901 (reported)", "False"],
          ["Option amounts are contract counts", "Underlying shares; class OPTION, type SH (reported)", "False"],
          ["BSOL ~47,500 shares", "33 shares at 30 Jun; 47,460 at 31 Mar (reported)", "Stale, not invented"],
          ["IBIT 10,407,635 shares / $355,732,983", "Matches (reported); +25.4% on the quarter (computed)", "Confirmed"],
          ["MSTR 3,830,709 shares", "630,709 shares / $58,244,442; rest was $3.2m of note principal", "Corrected"],
          ["MSTR share count halved on the quarter", "Equity rose 567,804 → 630,709; the debt halved (computed)", "Corrected"],
          ["Circulating \"624,387+ MSTR shares\" understated", "624,387 is exactly the common-stock line (reported)", "False"],
          ["IREN 3,993,785 shares / $128,027,666", "2,699,785 shares / $123,947,214; rest was bond principal", "Corrected"],
          ["Cipher Mining not in the filing", "Filed as CIPHER DIGITAL INC, $17,583,910 (reported)", "False"],
          ["Semiconductor claim of $240B+", "$34,151,942,209 across AMD, TSMC, Qualcomm (computed)", "Confirmed as overstated"],
          ["Applied Materials held", "No row under any CUSIP or name variant found", "Confirmed absent"],
          ["Berkshire is top non-tech holding", "$6.50B; JNJ, Mastercard, AbbVie all larger (reported)", "Confirmed as wrong"],
          ["\"Ten largest positions\" table", "Omitted two funds ranking 4th and 6th (normalized)", "Corrected"],
          ["Share lines total $1,712,331,516,547", "That is non-option rows; shares alone are $1,710,607,343,286", "Corrected"],
        ],
      },
      { type: "h2", text: "Methodology" },
      {
        type: "p",
        text: `Source: JPMorgan Chase & Co, CIK 0000019617, Form 13F-HR, accession 0000019617-26-000325, period 30 June 2026, filed 12 August 2026. Prior-quarter comparisons use accession 0000019617-26-000225, period 31 March 2026 — a 13F-HR/A carrying 33,063 entries and $1,557,139,501,048, which is a restatement rather than a partial amendment.`,
      },
      {
        type: "p",
        text: `The information table was parsed twice over all 34,064 rows: once with a namespace-tolerant pattern reader and once with a streaming XML parser, written independently. Both reconcile exactly to the filer's stated entry total and value total and agree on every derived count. Rows are classified on both putCall and sshPrnamtType, so an option row is never read as a share position and convertible debt reported as a principal amount is never counted as shares. Share and option values are never summed into a single exposure figure.`,
      },
      {
        type: "p",
        text: `Issuer aggregation uses the six-character CUSIP prefix, which folds an issuer's option lines onto its share line and merges nothing else; where a company's equity and debt carry unrelated prefixes, as IREN's do, they are reported separately. Percentages are stated against either the ordinary-share total of $1,710,607,343,286 or the full reported total of $1,807,041,234,839, and the base is named each time.`,
      },
      {
        type: "p",
        text: `Market prices, returns and market capitalisation are not from the 13F. Prices are daily closes from the consolidated tape as of 1 September 2026; the share count is JPMorgan's own cover-page tag from the 10-Q for the quarter ended 30 June 2026. Return windows name their start date.`,
      },
      {
        type: "p",
        text: `Limitations: the filing is a quarter-end snapshot of Section 13(f) securities filed up to 45 days later, excludes short positions, cash, most debt, non-US listings and written options, and aggregates 17 other included managers. It does not establish the purpose of any position. The SEC does not verify these filings.`,
      },
      { type: "h2", text: "Bottom line" },
      {
        type: "p",
        text: `The filing is internally consistent and reconciles to the dollar. Every difficulty in reading it is a question of what each row represents: whether an amount is shares or principal, whether a row describes a security or an option over it, whether two rows naming similar issuers are the same company, and which of six defensible counts someone means by "positions".`,
      },
      {
        type: "p",
        text: `That is where filing-derived data actually breaks, and the failure mode is never a number that looks obviously wrong. It is a number that looks entirely reasonable, reconciles against something, and means something other than what its label says.`,
      },
      {
        type: "p",
        text: `None of this is investment advice. Everything above is checkable against accession 0000019617-26-000325. If you parse it and reach a different number, we would like to know, and we will correct this post and say plainly what changed — as we have here.`,
      },
    ],
  },
  // Travel — the traveller-facing companion to the hotel map engineering post
  {
    slug: "explore-hotels-resorts-villas-on-the-world-map",
    title:
      "Explore the World, One Stay at a Time: Finding Hotels, Resorts and Villas on the Map",
    excerpt:
      "Most hotel searches start with a text box and end with a list of 400 results you scroll past. This one starts with the world. Open the FurlPay map and explore destinations visually — 507 curated luxury properties across 79 countries, every hotel OpenStreetMap knows layered underneath, ten collections from overwater villas to alpine chalets, and rates you can settle in USDC. Here is how to actually use it.",
    category: "travel",
    date: "2026-09-01",
    readMins: 11,
    author: "Ashutosh Kumar Singh",
    cover: "/blog/hotel-map.jpg",
    body: [
      {
        type: "p",
        text: `Almost every hotel search begins the same way: a blank text box asking where you are going, as though you had already decided. Then a list. Then forty minutes of opening a map in one tab and a property page in another, trying to work out whether "5 minutes from the beach" means five minutes walking or five minutes in a taxi through traffic.`,
      },
      {
        type: "p",
        text: `The [FurlPay hotel map](https://furlpay.com/hotels/map) inverts that. It opens on the whole world, with real properties already on it, and you find somewhere to stay by looking rather than by typing. This post is the practical guide — what is on the map, how to move through it, and what each control actually does.`,
      },

      { type: "h2", text: "Location is the thing people actually choose on" },
      {
        type: "p",
        text: `This is not a stylistic preference. When SiteMinder surveyed almost 12,000 travellers across 14 countries for its [Changing Traveller Report 2026](https://www.siteminder.com/changing-traveller-report/), location came out at the top of what people scrutinise before booking — ahead of the things a list view is good at showing. The same research found 58% of travellers now choose superior or luxury rooms, and that [stays are getting shorter](https://www.siteminder.com/r/latest-trends-in-hotel-industry/), with one-night bookings rising sharply over the last three years.`,
      },
      {
        type: "p",
        text: `Put those together and you get a very specific kind of traveller: someone taking more, shorter, better trips, for whom exactly where a property sits matters more than it used to. A two-night stay has no slack in it. Being on the wrong side of a city is not a minor inconvenience — it is a meaningful fraction of the trip.`,
      },
      {
        type: "p",
        text: `A list cannot answer that question. A map answers it before you have read a single description.`,
      },

      { type: "h2", text: "Explore the world, one stay at a time" },
      {
        type: "p",
        text: `The map opens on the world. There is nothing to fill in first, and no empty state telling you to zoom in before it will show you anything. At that height, properties gather into numbered circles — and those numbers are real counts, so clicking one zooms to exactly the properties it just counted. Nothing appears or disappears in a way you cannot follow.`,
      },
      {
        type: "p",
        text: `Zoom into a city and the circles break apart into individual properties. 150 of the curated ones draw as a small round photograph of the actual building rather than a coloured dot, which is genuinely useful at speed: you recognise the Burj Al Arab's sail or a Maldivian overwater villa from the marker itself, without reading a word.`,
      },
      {
        type: "p",
        text: `Underneath the curated layer sits every hotel OpenStreetMap has recorded in that view — smaller, quieter markers that fill in the neighbourhood around the headline properties. So a zoomed-in view of Lisbon shows you both the handful of properties we have written about and the couple of hundred others that exist on that street.`,
      },

      { type: "h2", text: "Find your perfect destination" },
      {
        type: "p",
        text: `The search box takes two completely different kinds of question, and it is worth knowing both:`,
      },
      {
        type: "ul",
        items: [
          "A place — \"Kyoto\", \"Amalfi Coast\", \"Queenstown\". The map flies there and shows you what is around.",
          "A property or a brand — \"Aman\", \"Belmond\", \"Oberoi\", \"Six Senses\". The map narrows to that name worldwide, which turns it into a way of seeing where a group actually operates. Type one and watch the pins scatter across four continents.",
        ],
      },
      {
        type: "p",
        text: `Your last six searches are remembered, so returning to somewhere you were looking at last night is one click rather than retyping. There is also a "centre on my location" control, for the case where the destination is wherever you happen to be standing.`,
      },

      { type: "h2", text: "Ten collections, not a wall of filters" },
      {
        type: "p",
        text: `Rather than thirty checkboxes, the curated properties are sorted into ten collections. These are the ones that exist, with what is actually in each:`,
      },
      {
        type: "table",
        headers: ["Collection", "Properties", "What lands in it"],
        rows: [
          ["Ultra-luxury", "312", "Aman, Four Seasons, Rosewood, Mandarin Oriental, Belmond and their peers"],
          ["Boutique", "214", "Smaller houses with a point of view — design-led, independent, or a single-property operator"],
          ["Heritage castles", "169", "Castles, manors, palaces and châteaux that were something else first"],
          ["Vineyard & wellness", "111", "Estates among the vines, and properties built around a spa rather than around a lobby"],
          ["Michelin dining", "99", "Where the restaurant is a reason to book the room"],
          ["Executive suites", "75", "City properties built for people travelling on business who would rather not feel like it"],
          ["Alpine chalets", "54", "Ski-in and mountain-side, concentrated in the Alps"],
          ["Overwater villas", "22", "The Maldives, French Polynesia, and the handful of others that do it properly"],
          ["Helipad transit", "19", "Properties you can actually arrive at by air"],
          ["Crypto escrow", "0 so far", "A FurlPay-defined collection for properties settling on our own rail — nothing has been classified into it yet"],
        ],
        highlightCol: 1,
      },
      {
        type: "p",
        text: `Alongside those, three simpler controls: property type (hotels, resorts or villas), a minimum star rating, and a toggle that hides any property whose exact position we could not independently confirm. That last one is unusual and worth explaining — it exists because we would rather show you a slightly rough pin and say so than quietly move it to a building we are not certain about.`,
      },

      { type: "h2", text: "Discover luxury in Dubai and the UAE" },
      {
        type: "p",
        text: `Dubai is one of the densest single cities on the map — eight curated properties, level with Tokyo and New York and just behind Paris and London on nine. It is a good place to see how the collections work in practice. Ten UAE properties are curated, eight of them in Dubai:`,
      },
      {
        type: "ul",
        items: [
          "Burj Al Arab Jumeirah — the sail, and still the shorthand for the whole city.",
          "Atlantis The Royal and One&Only The Palm — the Palm Jumeirah at two very different registers.",
          "Armani Hotel Dubai — inside the Burj Khalifa, for people who want the tower rather than the beach.",
          "Jumeirah Al Qasr — the Madinat, waterways and all.",
          "Bulgari Resort Dubai — Jumeirah Bay island, deliberately apart from the strip.",
          "Four Seasons Resort Dubai at Jumeirah Beach and Four Seasons Hotel DIFC — beach and business district, the same operator answering two different trips.",
          "Emirates Palace Mandarin Oriental, Abu Dhabi — an hour down the coast and a completely different scale.",
          "Qasr Al Sarab Desert Resort by Anantara — in the Liwa dunes, which is the answer to \"what else is there beyond the skyline?\"",
        ],
      },
      {
        type: "p",
        text: `Seeing them on a map rather than in a list makes the geography obvious in a way the names never do: the beach properties cluster on one coastline, the business hotels sit inland around the financial district, and Qasr Al Sarab is a two-and-a-half hour drive into the desert. That is a trip-shaping fact, and it is invisible in a ranked list.`,
      },

      { type: "h2", text: "Travel by region" },
      {
        type: "p",
        text: `Because the map is global and always answering, you can explore by simply moving it. The curated set is weighted towards where luxury hospitality is actually concentrated, and the distribution is worth knowing before you go looking:`,
      },
      {
        type: "table",
        headers: ["Region", "Curated properties", "Where they cluster"],
        rows: [
          ["Europe", "167", "Paris and London (9 each), Courchevel (7), Rome (5), plus the Italian lakes and the Alps"],
          ["North America", "80", "New York (8), and resort country across the US and Canada"],
          ["Southeast Asia", "40", "Singapore (6), Thailand (12 nationwide), Bali and the Vietnamese coast"],
          ["East Asia", "38", "Tokyo (8), Kyoto (6), Hong Kong (6), Shanghai (6)"],
          ["South America", "29", "São Paulo (4), Patagonia, the Atacama and the Peruvian highlands"],
          ["Middle East", "28", "Dubai (8) and Abu Dhabi, plus the Levant and Oman"],
          ["Africa", "25", "Safari camps and lodges, Cape Town and Marrakech"],
          ["South Asia", "23", "India (17), plus Sri Lanka, Bhutan and Nepal"],
          ["Indian Ocean", "20", "The Maldives (14), Seychelles and Mauritius"],
          ["Caribbean", "20", "Island resorts and private-island properties"],
          ["Australia, NZ & Pacific", "33", "Including Bora Bora (5) and the French Polynesian atolls"],
        ],
      },
      {
        type: "p",
        text: `That is the curated spine. Zoom into any of those regions and OpenStreetMap fills in everything else that is mapped around them — which is how a map with 507 curated properties still shows you hundreds of options in a single city.`,
      },

      { type: "h2", text: "Beaches, cities, mountains and the far-flung" },
      {
        type: "p",
        text: `The collections make some very specific kinds of trip easy to find, and it is worth naming them as trips rather than as filters.`,
      },
      {
        type: "p",
        text: `BEACH AND ISLAND. Turn on overwater villas and 22 properties light up across the Maldives, French Polynesia and the Indian Ocean — the whole category, visible at once, which is a far better way to choose between atolls than reading twenty descriptions. The Maldives alone carries 14 curated properties across several atolls.`,
      },
      {
        type: "p",
        text: `CITY BREAKS. Paris and London hold nine each, Tokyo and New York eight, Kyoto, Hong Kong, Shanghai and Singapore six. In a city the map earns its keep on the question a list cannot answer: is this actually where I want to wake up? Zoom to street level and the answer is right there — the river, the park, the station, the distance to the thing you came for.`,
      },
      {
        type: "p",
        text: `MOUNTAIN AND ALPINE. 54 alpine chalet properties, with Courchevel alone holding seven — enough that the map shows you the shape of a ski region rather than a list of names you cannot place relative to a lift.`,
      },
      {
        type: "p",
        text: `DESERT, SAFARI AND SLOW TRAVEL. This is where the map is most useful, because these properties are defined by being far from everything and a list flattens that completely. 40 lodges and 5 camps sit in the dataset — Qasr Al Sarab in the Liwa dunes, safari camps across Botswana and Kenya, lodges in Patagonia. Forbes called ["deep luxury" the trend that would set the tone for 2026](https://www.forbes.com/sites/angelinavillaclarke/2025/11/19/deep-luxury-the-travel-trend-that-will-set-the-tone-for-2026/) — fewer places, longer, with more intent. Remoteness is the point, and remoteness is a geographic fact you have to see.`,
      },
      {
        type: "p",
        text: `PRIVATE AND VILLA STAYS. Filter to villas for properties with more space and more privacy, and note what else is in the mix: 10 estates, 3 castles, 3 châteaux, 3 manor houses and 3 ryokan. Whole buildings rather than rooms in them.`,
      },

      { type: "h2", text: "What you can compare at a glance — and what you cannot" },
      {
        type: "p",
        text: `Hover a marker (or tap it on a phone) and a card gives you the photograph, the star class, the collections it belongs to, and where the information came from. Click through and the full panel opens with a photo gallery you can page through.`,
      },
      {
        type: "p",
        text: `Here is the honest limitation, and it is deliberate. The map does not show you a price on every pin, and it will not let you filter the world by budget. Nightly rates are fetched for the property you are actually looking at, for your dates, at the moment you ask — because a rate stored last week and shown as today's is simply a wrong number. If a rate cannot be confirmed for a specific property, the map leaves it blank rather than estimating one.`,
      },
      {
        type: "p",
        text: `The trade is real and worth stating plainly: you lose the ability to sort a hundred hotels by price at once, and you gain the guarantee that every price you do see is a live quote for your dates rather than a plausible-looking number. We think that is the right way round for a discovery surface. It is also why the map is fast — drawing it costs no rate lookups at all.`,
      },

      { type: "h2", text: "Save what you like, and send it to someone" },
      {
        type: "ul",
        items: [
          "Tap the heart on any property to save it. The list works signed-out, lives in your browser, and holds up to 500 places — enough for a shortlist you build over weeks.",
          "Any view of the map is a link. Pan to a spot, copy the URL, and whoever opens it sees exactly what you were looking at, at the same zoom. Planning a trip with other people usually means arguing about locations, and this is the fastest way to end that argument.",
          "The same map, the same properties and the same counts run on the website, the iPhone app and the Android app — so a shortlist you build on a laptop is the one you open on a phone at the airport.",
        ],
      },

      { type: "h2", text: "And then you can actually pay for it" },
      {
        type: "p",
        text: `The map is the front half. The back half is that a booking made through FurlPay settles in USDC on Arbitrum — around a second to settle, 0.5% rather than the 2.9–3.5% a card takes, no FX spread when both sides are already holding dollars, and a signed receipt rather than an authorisation that can be reversed months later.`,
      },
      {
        type: "p",
        text: `For a traveller that mostly shows up as not being quietly charged a foreign transaction fee on an international booking. For the property it shows up as keeping roughly three percent of the booking that a card network would otherwise take. Same room, same night, different rail.`,
      },

      { type: "h2", text: "Start exploring" },
      {
        type: "p",
        text: `The map is at [furlpay.com/hotels/map](https://furlpay.com/hotels/map). It opens on the world, so there is nothing to decide before you start. Turn on a collection and see where in the world it lands. Type a brand you like and watch where it operates. Zoom into a city you already know and check whether the property you were considering is really where you assumed it was.`,
      },
      {
        type: "p",
        text: `Where you go next is a better question when you can see all of the answers at once.`,
      },
    ],
  },
  // Product launch — FurlPay Wallet handles --------------------------------
  {
    slug: "furlpay-wallet-names-are-live-claim-your-payment-handle",
    title: "FurlPay Wallet Names Are Live: Claim the Handle Your AI Agents Will Pay With",
    excerpt:
      "Reserve yourname.furlpay.com — one human-readable identity for you and every agent you run. Here is why payment handles suddenly matter in 2026, how the x402 standard turned HTTP into a payment rail, exactly how reservation and consent work under the hood, and the security decisions behind binding a name to an account.",
    category: "product-news",
    date: "2026-08-10",
    readMins: 12,
    author: "Ashutosh Kumar Singh",
    featured: true,
    // The wallet card itself — the thing the post is about. Filename avoids the
    // `furlpay*.png` rule in .gitignore, which would silently keep it out of
    // the repo and 404 in production.
    cover: "/blog/wallet-names.png",
    body: [
      {
        type: "p",
        text: `Wallet names are live. From today you can reserve a FurlPay Wallet handle at furlpay.com/wallet — a short, human-readable name like yourname.furlpay.com that your account, and every AI agent you run, presents when it pays for something on the web. This post is the long version: what a payment handle actually is, why the timing is not an accident, how the reservation and consent flow works line by line, and the security decisions we made that are not obvious from the outside.`,
      },
      {
        type: "p",
        text: `Two honest framings up front. First, this is a reservation, not a funded wallet — you are claiming the name now so it is yours when the funded flows open. Second, a handle is an addressing layer, not a new form of money. The money underneath is the same USDC settlement FurlPay already runs. What changes is who, or what, can be addressed.`,
      },

      { type: "h2", text: "The addressing problem nobody solved" },
      {
        type: "p",
        text: `Every payment system needs an answer to a boring question: how do I refer to the party being paid? Banking answered it with account numbers and routing codes. Crypto answered it with a 42-character hexadecimal string. Both answers are machine-friendly and human-hostile. A hex address cannot be read aloud, cannot be typed from memory, cannot be checked at a glance, and offers no way to tell a legitimate counterparty from a lookalike. The industry's response for a decade has been to tell users to "verify the first and last four characters," which is security advice that quietly outsources the hard part to the person least equipped to do it.`,
      },
      {
        type: "p",
        text: `Naming layers have existed for years and they solved the readability half. What they did not solve is the authorization half. Knowing that a name maps to an address tells you where money goes. It does not tell you what the holder of that name is allowed to do, who vouches for it, or what happens when the thing initiating the payment is not a person at all.`,
      },

      { type: "h2", text: "Why 2026 made this urgent: HTTP grew a payment rail" },
      {
        type: "p",
        text: `The thing that changed is x402 — a protocol that revives the long-dormant HTTP 402 "Payment Required" status code and turns it into a working handshake. A client requests a resource, the server answers 402 with a price and payment details, the client attaches payment and retries, and the server returns the content. Payment stops being a checkout flow that happens on a separate page and becomes a property of the request itself.`,
      },
      {
        type: "p",
        text: `That distinction matters enormously once the client is software. A human can be redirected to a payment page, read a form, enter a card, and complete a 3-D Secure challenge. An autonomous agent cannot — not because it is incapable, but because every one of those steps assumes a human is present to consent. x402 removes the assumption. A payment becomes a header, and a header is something a program can produce.`,
      },
      {
        type: "p",
        text: `x402 is genuinely open, which is the part worth dwelling on. It was co-created by Coinbase and Cloudflare, and the standard is now hosted by the Linux Foundation with an x402 Foundation around it whose membership includes Stripe, Visa, Mastercard, Google, Amazon Web Services and Circle. That is an unusual coalition — card networks, hyperscalers and a stablecoin issuer agreeing on one wire format. It means the rail is not a single company's proprietary channel, and building on it is not a bet on any one vendor surviving.`,
      },
      {
        type: "p",
        text: `On 4 August 2026, Cloudflare launched its own wallets and opened cloudflare.pay handle reservations on exactly this thesis: agents need a balance and a name to present when they buy APIs, inference and content. When infrastructure companies at that scale start shipping the same primitive in the same quarter, it stops being a speculative feature and starts being table stakes. We are shipping our version because FurlPay has been an x402 product since well before the handle layer existed, and our users should not have to hold an identity on someone else's namespace to use it.`,
      },

      { type: "h2", text: "What a handle actually buys you" },
      {
        type: "p",
        text: `A payment handle does four things a raw address cannot:`,
      },
      {
        type: "ul",
        items: [
          "It is verifiable by eye. yourname.furlpay.com either is or is not the party you meant. There is no truncated-hex ritual and no visual near-collision to fall for.",
          "It is stable across chains. The address underneath can differ per chain, rotate, or migrate to a new contract; the name you publish on an invoice or a website does not have to change with it.",
          "It carries a namespace with an operator behind it. A name issued under furlpay.com means an account exists, was authenticated, and can be held accountable — which a self-generated address, by construction, never means.",
          "It scopes down to agents. A single account can front many agents, each addressable and each independently limited, without scattering unlabeled addresses no one can later attribute.",
        ],
      },
      {
        type: "table",
        headers: ["", "Raw address", "Generic name service", "FurlPay handle"],
        rows: [
          ["Human-readable", "No", "Yes", "Yes"],
          ["Bound to an authenticated account", "No", "No", "Yes"],
          ["Agent sub-identities with spend limits", "No", "No", "Yes"],
          ["Works as an x402 payment identity", "Partially", "Partially", "Yes"],
          ["Revocable by the owner", "No", "Varies", "Yes"],
        ],
        highlightCol: 3,
      },

      { type: "h2", text: "Agents are the real reason" },
      {
        type: "p",
        text: `The strongest argument for handles is not human convenience. It is that the agentic web has an accountability gap. When an agent buys an API call, a dataset or a block of inference on your behalf, three questions need answers after the fact: which agent did this, whose authority was it acting under, and what was it permitted to spend? An unlabeled address answers none of them. It is an anonymous payer with no ceiling.`,
      },
      {
        type: "p",
        text: `A handle plus a spending policy answers all three. The name identifies the actor, the account behind it establishes authority, and the policy sets the ceiling before anything is spent rather than after. This is the model FurlPay already runs in its agent control plane — agent keys owned by an account, with enforced policies — and the handle is the public-facing half of it. The private half was already there.`,
      },
      {
        type: "p",
        text: `It is worth being precise about what "autonomous" should mean in a payment context. It should mean an agent can complete a purchase inside limits you set in advance, without waking you up. It should not mean an agent can decide its own limits. Any system that blurs those two is not automating your intent; it is removing you from a decision you never delegated.`,
      },

      { type: "h2", text: "How reservation actually works" },
      {
        type: "p",
        text: `The flow is deliberately short: type a name, see whether it is free, sign in, review what you are granting, authorize. Underneath, each of those steps has a decision behind it worth explaining.`,
      },
      {
        type: "p",
        text: `Availability checking runs as you type, debounced, against a public read-only endpoint. Every candidate is normalized before it is judged — trimmed, lowercased, and validated against a strict character set of letters, digits and hyphens, with no leading or trailing hyphen so a handle always reads cleanly as a subdomain. Normalization happens in one shared module used by both the availability check and the reservation itself, which matters more than it sounds: if two endpoints disagree about what a name resolves to, a name can appear free and then be claimed as something subtly different.`,
      },
      {
        type: "p",
        text: `A reserved-word list blocks the names that would be dangerous in a payment namespace — brand terms, support, security, billing, admin, api, and similar. A handle reading support.furlpay.com in the hands of an arbitrary user is a phishing primitive, not a username.`,
      },
      {
        type: "code",
        lang: "http",
        code: `GET /api/check?tag=satoshi

200 OK
{ "available": true, "normalized": "satoshi" }

GET /api/check?tag=support

200 OK
{ "available": false, "error": "That name is reserved." }`,
      },
      {
        type: "p",
        text: `The claim itself is a single atomic operation — a set-if-absent against durable storage. The first authenticated request to reach an unclaimed name wins it; a concurrent request for the same name loses cleanly and gets a 409 rather than a second copy of the record. This is the same primitive used for the authorization-code single-use guarantee elsewhere in the system, and it is the only correct answer for first-come-first-served allocation. A read-then-write would leave a window in which two people both see "available" and both proceed.`,
      },

      { type: "h2", text: "The consent step, and why it requires signing in" },
      {
        type: "p",
        text: `Reserving a handle asks you to sign in and then shows an explicit authorization screen: FurlPay Wallet is requesting read access to your profile, your balances and your transaction history, listed in plain language with a Read badge on each. You authorize or you cancel.`,
      },
      {
        type: "p",
        text: `We could have skipped it. Anonymous reservation is a lower-friction growth number and a worse product. A handle that is not bound to an authenticated account is a name with no owner — it cannot be recovered if you lose access, it cannot be revoked if it is abused, and it cannot be defended if someone else claims yours. Binding at claim time is what makes the name yours in a sense that survives a dispute.`,
      },
      {
        type: "p",
        text: `The permissions themselves are read-only by design, and that is a hard boundary rather than a default. Reserving a name grants no ability to move money, ever. In FurlPay's model, moving money is a separate action that requires a separate, stronger authorization — and an AI agent never gets it implicitly. Payments are prepared for approval; they are not executed on the strength of having been asked nicely.`,
      },

      { type: "h2", text: "The security decisions behind it" },
      {
        type: "p",
        text: `Some of these are invisible when the flow works, which is the point:`,
      },
      {
        type: "ul",
        items: [
          "One handle, exactly one account. The binding is atomic, so a race cannot produce two owners, and a name owned by another account is rejected outright rather than silently overwritten.",
          "Session-gated writes. The reservation endpoint requires a verified session and returns a 401 to anonymous callers, so no handle can ever be claimed without an account behind it.",
          "Cross-site protection. The write rejects requests whose origin is not our own, so a hostile page cannot ride your session cookie to claim a handle in your name.",
          "Rate limits on both halves. The public availability check is limited per IP so the namespace cannot be enumerated at speed; the write is limited far more tightly because one account only ever needs a handful.",
          "Schema validation on every request body, with a hard size cap, before any of it reaches storage.",
          "Fail closed. If the datastore is unreachable, the check reports unavailable rather than guessing. Claiming a name is not something to be optimistic about.",
          "An audit record for every reservation — which account claimed which handle, with which scopes, and when.",
        ],
      },
      {
        type: "p",
        text: `One decision we deliberately did not make: we did not widen the redirect allowlist on FurlPay's existing OAuth server to accommodate this flow. That allowlist is the single most security-sensitive check in the connector — it is what stands between an authorization code reaching its client and reaching an attacker. Loosening a proven boundary to save writing a first-party flow would have been a poor trade, so the wallet consent is its own session-gated path and the connector's rules are untouched.`,
      },

      { type: "h2", text: "Reserve yours" },
      {
        type: "p",
        text: `Go to furlpay.com/wallet, type the name you want, and watch the card update live as you type — the handle you are claiming is rendered onto it. If the name is free you will get a green check, then sign in, review the permissions, and authorize. The name is yours from that moment.`,
      },
      {
        type: "ul",
        items: [
          "Three to thirty-two characters, letters, digits and hyphens.",
          "Case does not matter — handles normalize to lowercase, so there is no confusable-capital trick.",
          "Read-only permissions. No money can move as a result of reserving a name.",
          "One name per account for now, so the namespace does not get hoarded before launch.",
        ],
      },

      { type: "h2", text: "What is next, honestly" },
      {
        type: "p",
        text: `Reservation is phase one. Funded account wallets, per-agent virtual wallets with hard spending policies, and resolution of a handle to a payment endpoint across the chains FurlPay already settles on are the phases after it. We are shipping the identity layer first because it is the piece that has to be right before anything else is built on top: names are the one part of a payment system you cannot quietly re-issue later without breaking every invoice, integration and reference that points at them.`,
      },
      {
        type: "p",
        text: `The broader bet is not that any single company wins the agentic payments layer. It is that HTTP-native payment becomes ordinary, the way TLS did — unremarkable, expected, and everywhere. When that happens, the useful question stops being which wallet you hold and becomes what your agents are permitted to do, and whether you can prove it afterwards. A name you own, bound to an account that answers for it, is where that starts.`,
      },
    ],
  },

  // Product launch — FurlPay on Wear OS -----------------------------------
  {
    slug: "furlpay-on-your-wrist-introducing-the-wear-os-app",
    title: "FurlPay on Your Wrist: Introducing the Wear OS App",
    excerpt:
      "Your portfolio, live market charts, one-tap Buy and Sell, card controls, USDC receive codes, flight booking and a voice assistant — on a watch. Here is a detailed walkthrough of every screen in the FurlPay Wear OS companion, how it stays secure without your phone, and why it is open source.",
    category: "product-news",
    date: "2026-07-18",
    readMins: 10,
    author: "Ashutosh Kumar Singh",
    featured: true,
    cover: "/blog/furlpay-wearos.jpg",
    body: [
      {
        type: "p",
        text: `A watch is the most glanceable screen a person owns. You do not open it — you flick your wrist, read one number, and drop your arm. That is exactly the interaction money deserves most of the time: not a full dashboard, but a five-second answer. So we built FurlPay for Wear OS — a companion app that puts your balances, live markets, card controls, travel and a voice assistant on the wrist, and does it without turning your watch into a shrunken phone screen.`,
      },
      {
        type: "p",
        text: `This post is the detailed tour: every screen, what it does, and the design and security decisions underneath. The app is built in Kotlin with Wear Compose Material 3, targets Wear OS 5 (tested against the Pixel Watch class of device), and it is open source. Two things to say up front, honestly: it is a companion to the FurlPay account you already have, and it is in active development — validated end to end on the Wear OS 5 emulator against live furlpay.com data, with physical-device testing and a Play Store listing still ahead. Nothing below is a mockup; every screen in this walkthrough runs.`,
      },
      { type: "h2", text: "Live markets, on your wrist" },
      {
        type: "p",
        text: `The screen on the cover is the watchlist. Each row carries the real brand logo — not a colored letter, the actual mark for Seagate, HP, United States Oil Fund and the rest — pulled from FurlPay's self-hosted asset library, with a two-letter monogram underneath as an instant fallback so a row is never blank or a broken image. Alongside the logo: the live price, the signed daily change in green or red, and a real one-day sparkline drawn from actual price bars. The list sorts by top movers and refreshes on its own every 30 seconds. Because market quotes are public data, this screen renders and updates even before your phone has signed the watch in.`,
      },
      {
        type: "p",
        text: `Tap any row and you land on the stock screen — the one that most resembles a trading terminal. A live header with the price and change sits above a full area chart, drawn as a mint gradient fading to black, rendered from real historical bars rather than a decorative squiggle. A timeframe strip lets you switch between 1D, 1W, 1M, 3M, 1Y and ALL, and the chart redraws for each. Below it are two buttons you will recognize from the design: a green + Buy and an outlined − Sell.`,
      },
      { type: "h2", text: "Buy and Sell — with a deliberate second step" },
      {
        type: "p",
        text: `Placing an order from a watch is powerful, so we made it safe by shape, not just by policy. Tapping Buy or Sell does not fire an order. It opens an amount step with fixed presets — $25, $50, $100, $250 — capped so a fat-finger on a 1.4-inch screen can never move a large sum. Choosing an amount advances to an explicit confirmation: "Buy $25.00 of LCID? Fractional market order," with a single Confirm button and a Cancel. That two-tap flow is the watch analogue of the biometric prompt you would get on the phone — the same principle that guards every sensitive action in the app. Orders are fractional notional, so you buy a dollar amount, not whole shares, and they settle against the same investing engine the FurlPay app uses.`,
      },
      { type: "h2", text: "Portfolio, spending and wallet at a glance" },
      {
        type: "p",
        text: `Beyond markets, the watch mirrors the parts of your account you actually check on the move:`,
      },
      {
        type: "ul",
        items: [
          "Portfolio — your total value and the day's change in dollars and percent, green or red, computed from your live holdings.",
          "Spending — a running total with Day, Week and Month range chips, so you can answer 'how much have I spent today' without unlocking anything larger.",
          "Wallet — your balances by token and chain, headlined by the total in USD.",
          "Home — a clean menu of tonal rows, each led by a hand-drawn vector icon: Markets, Wallet, Cards, Portfolio, Spending, Travel, Receive and Ask Guardian.",
        ],
      },
      { type: "h2", text: "Card controls, and a safety asymmetry that matters" },
      {
        type: "p",
        text: `The Cards screen shows each card's label, last four digits and status. From the watch you can freeze a card in two taps — the fastest possible response if you think you have lost it or spotted a bad charge. But you cannot unfreeze it from the watch. Un-freezing is deliberately phone-only, behind a biometric prompt. This asymmetry is intentional: the panic action (lock it now) should be instant and always available, while the action that re-enables spending should require the stronger authentication only your phone can provide. A watch that could both freeze and unfreeze with a tap would be a weaker security posture, not a more convenient one.`,
      },
      { type: "h2", text: "Receive money with a code" },
      {
        type: "p",
        text: `The Receive screen turns your wrist into a payment target. It renders a QR code of your account's receive address, so someone can scan and send you USDC on the spot. The address is cached on the watch, so the code still appears when you are offline — useful precisely in the moments a phone is inconvenient to dig out.`,
      },
      { type: "h2", text: "Travel: flights, deals, and book-and-pay from the wrist" },
      {
        type: "p",
        text: `The Travel screen brings the FurlPay Travels experience to the watch. It shows your trips with their amount, payment method and status; a live list of flight offers complete with real airline logos, prices and times; and flash hotel deals. Tapping a deal resolves a real bookable property for that city, then shows a confirmation with the nightly rate, dates and an explicit "Book and pay" step. The important detail is that the watch never decides the price — it sends identifiers and a one-time key, and the server computes and owns the final total, deduplicating retries so a booking happens at most once. It is the same server-authoritative pricing model the phone and web use, faithfully carried onto the smallest screen.`,
      },
      { type: "h2", text: "Ask Guardian: a voice assistant that cannot spend your money" },
      {
        type: "p",
        text: `Press the microphone and you can ask about your money in plain language — "what's my balance," "next flight," "how much did I spend this week." Voice is button-triggered by design; there is no always-listening wake word draining the battery or your privacy. A fast deterministic parser handles the common questions locally, and only falls back to a Gemini model (via Firebase AI Logic) for anything it does not recognize. Crucially, the voice session on the watch is read-only by construction: it can answer, but it declares no money-moving tools at all. Anything that would move funds is refused on the watch and handed back to the phone, where a biometric prompt gates it. The companion phone app additionally offers a full bidirectional live-voice conversation; the watch keeps to the fast, safe subset.`,
      },
      { type: "h2", text: "Tiles and complications: the zero-tap layer" },
      {
        type: "p",
        text: `The best watch interaction is often no taps at all. FurlPay ships Wear OS tiles — swipeable panels beside your watch face — for your wallet balance, portfolio change, a market snapshot, travel, your next event and a QuickPay receive code. Each tile deep-links straight into its screen, so a tile tap lands on the action, never a menu. It also ships watch-face complications — the small live fields you can place on your own watch face — for your balance, daily spend, portfolio change and next event. Put your balance on your favorite face and it is simply always there.`,
      },
      { type: "h2", text: "The other half: Life Guardian" },
      {
        type: "p",
        text: `The app carries a second identity beyond money. Life Guardian is an escalating reminder system for the things you genuinely cannot miss. You create a reminder on the phone with a priority, and for critical ones the app arms an alarm ladder that rings on both the phone and the watch, escalating in intensity and bypassing Do Not Disturb. Acknowledging on either device silences both. The schedule survives a reboot — a background heartbeat re-arms the ladder — because an alarm you cannot miss is worthless if a restart quietly disables it. It is a deliberately different discipline from a normal notification, reserved for a small set of truly important events.`,
      },
      { type: "h2", text: "Designed for a watch, not shrunk to fit one" },
      {
        type: "p",
        text: `Every visual choice serves the wrist. The palette is AMOLED-first: a true-black background, because black pixels are off pixels on an OLED and cost no battery, with a mint accent and cool off-white text. There is not a single emoji anywhere in the interface — every glyph is a hand-drawn vector on one consistent grid and stroke weight, including the FurlPay mark itself, so the set reads as one family and stays crisp at any size. Ambient mode dims the screen rather than blanking it, keeping your balance or next event glanceable when your wrist is down. A considered haptic vocabulary gives each action its own feel. And navigation never goes more than two levels deep, with swipe-to-go-back always honored.`,
      },
      { type: "h2", text: "Standalone by design, secure by architecture" },
      {
        type: "p",
        text: `The watch is not a dumb terminal tethered to your phone. After your phone syncs a session token — stored in the watch's hardware-backed keystore, never in plain text — the watch talks to furlpay.com directly over its own connection, and falls back to an encrypted on-device snapshot when it is offline. That is what lets markets, cards and travel work even when your phone is in another room. The security model is layered: the freeze-yes, unfreeze-no card asymmetry; the read-only voice session; the two-step order confirmation; and the server-authoritative pricing on every payment. The watch is allowed to do the fast, safe things instantly, and to hand the sensitive things back to the phone where the stronger authentication lives.`,
      },
      { type: "h2", text: "Open source, and what comes next" },
      {
        type: "p",
        text: `The Wear OS app is open source. You can read the full architecture, the security model and every screen's code in the public repository at [github.com/FurlPay/furlpay-wearos](https://github.com/FurlPay/furlpay-wearos) — we would rather you verify how card freezing and voice permissions work than take our word for it. What is left before a general release is honest and specific: testing on a physical phone-and-watch pair, and a Play Store listing. If you build for Wear OS, or you just want your FurlPay balance on your wrist, follow the repository — and if you are not yet on FurlPay, [start with the app](/products) and the watch will be waiting when it ships.`,
      },
    ],
  },
  // Macro thesis — stablecoins overtaking native crypto for payments -----
  {
    slug: "stablecoins-overtook-crypto-for-cross-border-payments",
    title: "Stablecoins Quietly Overtook Crypto for Cross-Border Payments — Here Is the Data",
    excerpt:
      "In 2025 stablecoins settled about $33 trillion on-chain, more than Visa and Mastercard combined, while Bitcoin and Ethereum's share of cross-border flows kept shrinking. The GENIUS Act, Stripe's $1.1B Bridge deal and Mastercard's $1.8B BVNK deal all landed in the same window. Here is what actually happened, with the figures checked against primary sources — and where a middleware layer like FurlPay fits.",
    category: "compliance",
    date: "2026-07-18",
    readMins: 12,
    author: "Ashutosh Kumar Singh",
    featured: true,
    cover: "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `A quiet decoupling has happened in digital assets, and most people still describe the industry as if it did not. Bitcoin and Ethereum remain what they always were — speculative assets, a store of value, computational fuel. But the thing actually moving real money across borders in 2026 is neither of them. It is fiat-pegged stablecoins, and the gap is no longer subtle.`,
      },
      {
        type: "p",
        text: `The headline that circulated in early 2026 was that stablecoins had "out-processed Visa." That part is true, and it is worth stating precisely because inflated versions of this number are everywhere. In 2025 stablecoins settled roughly [$33 trillion in on-chain volume, ahead of the roughly $25.5 trillion Visa and Mastercard processed combined](https://www.visualcapitalist.com/charted-stablecoins-are-now-bigger-than-visa-or-mastercard/). If you have seen "$46 trillion" quoted for the same year, treat it with suspicion — the defensible, primary-sourced figure is in the low thirties of trillions. Raw on-chain volume also includes trading bots, exchange routing and arbitrage, so the more honest measure is adjusted volume, which strips that noise. Adjusted stablecoin volume [reached about $28 trillion in real economic activity in 2025, growing at roughly 133% a year since 2023](https://www.chainalysis.com/blog/stablecoin-utility-future-of-payments/).`,
      },
      { type: "h2", text: "The decoupling, in one paragraph" },
      {
        type: "p",
        text: `For most of crypto's history, cross-border value moved through Bitcoin and Ethereum, and stablecoins were mostly a trader's parking spot between volatile positions. The 2022 collapse of the TerraUSD algorithmic stablecoin — which erased tens of billions in a matter of days — paradoxically accelerated the opposite trend: capital rotated hard into fully-reserved, fiat-backed tokens, and their transaction volume decoupled from Bitcoin's price entirely. By 2025 the payment story had nothing to do with the trading story. Enterprises and consumers in inflationary economies were using dollar tokens because they clear in seconds, cost cents, run 24/7 and are programmable — none of which depends on where BTC is trading that week.`,
      },
      {
        type: "p",
        text: `The market's own plumbing confirms it. The total stablecoin supply sat around [$316 billion in mid-2026, with Tether (USDT) near $187 billion and USD Coin (USDC) near $75 billion](https://bitcoinfoundation.org/news/stablecoin-news/stablecoin-market-cap-tops-321b/) — the two issuers together controlling roughly four-fifths of the market. Around 60% of stablecoin flows are now business-to-business, and by industry estimates the large majority of financial institutions are already using or piloting stablecoin rails.`,
      },
      { type: "h2", text: "Why the migration is structural, not hype" },
      {
        type: "p",
        text: `The reason this is not another cycle is that it fixes a real, measurable cost. The legacy cross-border system relies on correspondent banking: a chain of pre-funded nostro and vostro accounts, multiple foreign-exchange conversions, and settlement that takes days. For a company importing components across a border, a wire can lock up capital for three to five days and hide the final amount behind an opaque FX markup. A dollar-pegged stablecoin collapses that to an atomic, programmable transfer that clears in seconds with no in-transit FX spread, because the asset is already the dollar.`,
      },
      {
        type: "p",
        text: `Consumer remittances are the second pillar. The global average cost to send $200 across borders is still stubbornly high — [around 6.4% on the World Bank's measure, and closer to 8-9% into parts of Sub-Saharan Africa](https://remittanceprices.worldbank.org/), far above the UN's 3% target. Moving that value as a stablecoin over a low-fee network and off-ramping into local currency compresses the cost dramatically. And in economies with chronic inflation or capital controls, stablecoins function as synthetic dollars: a savings instrument, not just a rail.`,
      },
      {
        type: "p",
        text: `Nigeria is the clearest case. The IMF, in a June 2026 analysis, noted that Nigeria absorbed about [$59 billion in crypto-asset inflows in a single year and accounts for roughly 60% of stablecoin inflows across Sub-Saharan Africa](https://www.imf.org/en/news/articles/2026/06/16/stablecoins-in-nigeria), driven by naira depreciation and limited access to official foreign exchange. The Fund frames this as a form of "digital dollarization" — useful for citizens, genuinely difficult for a central bank trying to run monetary policy.`,
      },
      {
        type: "table",
        headers: ["Rail", "Settlement", "Typical cost / $1,000", "In-transit FX"],
        rows: [
          ["SWIFT bank wire", "1-5 business days", "$25-50 + intermediary fees", "1-3%"],
          ["Card networks", "1-3 days", "1-3% merchant fee", "1-2%"],
          ["Money transfer operators", "Minutes to days", "$5-40", "1-4%"],
          ["Stablecoin (L2 / Tron / Solana)", "Seconds", "Cents to a few dollars", "None (USD-pegged)"],
        ],
        highlightCol: 0,
      },
      {
        type: "p",
        text: `The catch — and it is an important one for anyone building here — is that the frictionless part is only the transfer. The cost has migrated to the edges: the on-ramp that turns local fiat into a stablecoin, and the off-ramp that turns it back. Whoever holds the deepest, most compliant liquidity at those gateways captures the economics. "The transfer is free" and "the payment is free" are not the same sentence.`,
      },
      { type: "h2", text: "2025-2026 was the institutional turn" },
      {
        type: "p",
        text: `Three things happened in close succession that moved stablecoins from the periphery into core financial infrastructure.`,
      },
      {
        type: "p",
        text: `First, regulation. In the United States, the [GENIUS Act was signed into law on July 18, 2025](https://www.whitehouse.gov/fact-sheets/2025/07/fact-sheet-president-donald-j-trump-signs-genius-act-into-law/), the first comprehensive federal framework for payment stablecoins. It restricts issuance to regulated entities, mandates full reserve backing in high-quality liquid assets, bans algorithmic stablecoins, and — notably — prioritizes token holders' claims in an issuer insolvency. The EU's MiCA regime had already brought stablecoins under a harmonized licensing framework across its member states. Legal certainty is exactly what enterprises were waiting for before wiring these rails into production.`,
      },
      {
        type: "p",
        text: `Second, the incumbents bought their way in. Stripe closed its [$1.1 billion acquisition of stablecoin infrastructure firm Bridge in February 2025](https://www.cnbc.com/2025/02/04/stripe-closes-1point1-billion-bridge-deal-prepares-for-stablecoin-push-.html) — the largest deal in its history — and Mastercard followed in March 2026 with an agreement to [acquire BVNK for up to $1.8 billion](https://www.cnbc.com/2026/03/17/mastercard-acquiring-stablecoin-startup-bvnk-in-crypto-bet.html), its biggest crypto deal to date, explicitly to connect on-chain payments with its fiat network. When Visa, Mastercard and Stripe are all paying nine and ten figures to own settlement infrastructure, the "is this real" question is settled.`,
      },
      {
        type: "p",
        text: `Third, the center of gravity keeps rising. In July 2026, Stripe reportedly [bid roughly $53 billion for PayPal](https://www.coindesk.com/business/2026/07/16/stripe-s-usd53-billion-paypal-bid-is-a-high-stakes-play-to-own-the-future-of-digital-payments) in a play to own the future of digital payments end to end. Whatever the outcome, the direction is unambiguous: programmable dollars are now a strategic asset that the largest payment companies are willing to reshape themselves around.`,
      },
      { type: "h2", text: "Where a layer like FurlPay actually fits" },
      {
        type: "p",
        text: `Here is the honest framing, because this is where a lot of writing on the topic overreaches. FurlPay is not a stablecoin issuer, and does not claim to be one under the GENIUS Act or any other regime. The issuance and reserve layer has been effectively commoditized by regulation and by the Stripe and Mastercard acquisitions. That is not where the remaining problem is.`,
      },
      {
        type: "p",
        text: `The remaining problem is orchestration. A CFO does not want to hold private keys, manage gas, or reason about which chain a supplier prefers. FurlPay sits at that layer: account abstraction (ERC-4337) and smart-contract wallets so a business can issue virtual cards, manage programmatic treasury, and run multi-chain cross-border payouts without the end user ever touching a seed phrase, a gas fee, or a network choice. The stablecoin is the settlement asset underneath; the product is the compliant interface on top that makes it usable.`,
      },
      {
        type: "p",
        text: `That is the pattern worth taking away from the 2021-2026 data. The base rails — issuance, reserves, raw transfer — are becoming plumbing, and plumbing trends toward zero margin. The durable value is in the orchestration and application layers that turn "$33 trillion moved on-chain" into something a business can actually operate: pick the right rail, absorb the on/off-ramp complexity, stay compliant across jurisdictions, and settle to the merchant in the currency they want. That is the layer we are building, and it is the layer the next decade of cross-border payments will be won in.`,
      },
      {
        type: "p",
        text: `A note on sources: the figures above are drawn from the IMF, the White House, Chainalysis, and primary reporting on the Stripe, Mastercard and market-cap numbers, and are current as of July 2026. Where a widely-shared figure could not be verified against a primary source — most notably the "$46 trillion" 2025 volume claim — we have used the lower, sourced number instead. In payments, an honest figure with a citation is worth more than an impressive one without.`,
      },
    ],
  },
  // Investor thesis — x402 settlement layer for travel -------------------
  {
    slug: "bypassing-the-3-percent-card-tax-x402-settlement-layer-travel",
    title: "Bypassing the 3% Card Tax: How I Built an x402 Settlement Layer for AI Agents and Travelers on Arbitrum",
    excerpt:
      "A $340 resort checkout loses $11.90 to five intermediaries before it reaches the hotel — three days later. Here is how I built Furlpay's x402 settlement layer on Arbitrum instead: the actual contract code, measured gas benchmarks from the 34-test suite, the paymaster math behind zero-gas UX, and a direct answer to 'why not just use Stripe?'",
    category: "engineering",
    date: "2026-07-08",
    readMins: 11,
    author: "Ashutosh Kumar Singh",
    featured: true,
    cover: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `I started building Furlpay because of a hotel bill in Dubai. Last year I watched a $340 resort checkout generate $11.90 in card processing fees — interchange, network assessment, cross-border markup, acquirer margin — before it reached the hotel's bank account three days later. The hotel earned $328.10 for a room that cost them roughly $280 to service. The other $11.90 went to five intermediaries whose only job was moving numbers between databases.`,
      },
      {
        type: "p",
        text: `That moment crystallized something I had been thinking about for months: the internet has a native protocol for every resource type — HTTP for documents, SMTP for mail, WebRTC for video — except money. And now that autonomous AI agents are booking travel, buying API calls and executing workflows in production, the absence of a native payment protocol is not a design curiosity. It is a [$198 billion annual extraction](https://www.clearlypayments.com/blog/the-future-of-interchange-fees-2026-and-beyond/) in the US alone. Furlpay is my answer: x402-native stablecoin payments, 2.2M+ bookable stays and flights, and fractional investing in one client — settled in USDC on Arbitrum, with zero gas fees and passkey security. This post explains what I built, how it works at the contract level, and why the economics are structurally hard to beat.`,
      },
      { type: "h2", text: "The numbers: why the 3% card tax is structural" },
      {
        type: "p",
        text: `The global travel industry cleared [$1.6 trillion in gross bookings in 2024 and is on track for $1.8 trillion by 2027](https://www.phocuswire.com/global-travel-next-chapter-phocuswright-research) — and it still runs on financial plumbing designed in the 1970s. A 2026 card transaction stacks [interchange of 1.15% to 3.15%, network assessments, and processor markups](https://www.swipesum.com/insights/the-true-cost-of-credit-card-processing-in-2025-a-merchants-guide), and travel is hit hardest because premium travel-rewards cards carry some of the highest interchange in the system. For a resort group doing $50 million in annual bookings, the 2-3.5% all-in cost is over $1 million a year in pure transaction overhead — a deadweight loss that buys no rooms, no staff and no guest experience. On top of the fee stack, merchants absorb chargebacks with 120-day dispute windows and rolling reserves that lock up working capital for months.`,
      },
      {
        type: "p",
        text: `Even the largest merchant settlement in history barely moves the number: the [$38 billion Visa/Mastercard settlement granted preliminary approval in April 2026](https://www.clearlypayments.com/blog/the-future-of-interchange-fees-2026-and-beyond/) trims average credit interchange by just 0.10% over five years. The 3% card tax is not a pricing decision — it is an architectural artifact of a five-party relay system, and litigation will not compress what only a different rail can. Meanwhile the rails are worse than expensive for machines: HTTP reserved status code 402 ("Payment Required") in the original web specification and it sat dormant for three decades, so a machine visiting a paid resource had no standardized way to discover a price, sign a payment and receive the resource in one round trip.`,
      },
      {
        type: "p",
        text: `And 2026 is the year that gap started to matter commercially. Visa [plugged its network into ChatGPT in June](https://www.americanbanker.com/payments/news/visa-mastercard-expand-agentic-ai-deployments), Mastercard executed its [first live agentic payment in Hong Kong in March](https://aimmediahouse.com/ai-bfsi/visa-and-mastercard-enter-agentic-commerce-war) — an AI agent booking and paying for an airport taxi with HSBC and DBS as issuers — and Sabre, PayPal and MindTrip announced the [travel industry's first end-to-end agentic booking system](https://www.oag.com/blog/march-2026-the-month-agentic-travel-gets-real). The demand side is arriving fast. What has been missing is a settlement layer priced and shaped for machines.`,
      },
      { type: "h2", text: "What I actually built: the x402 settlement flow" },
      {
        type: "p",
        text: `In April 2026 the [Linux Foundation launched the x402 Foundation](https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol), taking contribution of the x402 protocol from Coinbase — with Cloudflare and Stripe as co-developers and initial support spanning Google, AWS, Microsoft, American Express, Mastercard, Visa, Circle and Shopify. That made HTTP-native machine payments an open, neutrally governed standard rather than one vendor's API. Adoption followed quickly: by late April, Coinbase reported [69,000 active agents and 165 million x402 transactions](https://www.coindesk.com/tech/2026/04/02/coinbase-s-ai-payments-system-joins-linux-foundation-gathers-support-from-google-stripe-aws-and-others) across the ecosystem.`,
      },
      {
        type: "p",
        text: `Furlpay applies that standard to the travel vertical end to end. When an AI agent — or a human using our app — books a room, the endpoint answers with a 402 carrying machine-readable payment requirements: the exact USDC amount in atomic units, the asset contract on Arbitrum One, the address to pay, and the resource the payment buys:`,
      },
      {
        type: "code",
        lang: "http",
        code: `HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "arbitrum-one",
    "asset": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "payTo": "0x7a3f…",
    "maxAmountRequired": "340000000",
    "resource": "/api/travel/book?hotel=…",
    "maxTimeoutSeconds": 300
  }]
}`,
      },
      {
        type: "ul",
        items: [
          "The agent signs an EIP-3009 transfer authorization over that exact amount, recipient and validity window — an off-chain signature that costs the signer zero gas.",
          "Our facilitator submits the authorization on Arbitrum, hardened against replay and free-riding attack classes by [x402-guard](https://github.com/FurlPay/x402-guard).",
          "The API verifies the on-chain settlement record, escrows the funds against the booking and mints an ERC-721 booking receipt — end to end in seconds, with no human in the loop.",
        ],
      },
      {
        type: "p",
        text: `The same rails serve the investing side of the client. With [Robinhood Chain's mainnet live on Arbitrum Orbit as of July 1](https://blog.arbitrum.io/robinhood-chain-mainnet/) and tokenized stocks trading around the clock, Arbitrum is consolidating as the settlement venue for consumer real-world assets — and a traveler's idle USDC balance can earn or invest in the same account that books the trip.`,
      },
      { type: "h2", text: "Show, don't tell: the settlement contract" },
      {
        type: "p",
        text: `When I sat down to write the settlement logic, the goal was to make the entire payment one atomic function call — no multi-step approvals, no intermediate custody, no callback hell. Here is the core of X402Facilitator.sol as it runs in our test suite today:`,
      },
      {
        type: "code",
        lang: "solidity",
        code: `/// @notice Settle a verified x402 payment. The signature is checked by
///         USDC against the payer, so the facilitator adds no trust
///         assumptions — it can't move funds the payer didn't authorize.
/// @param resourceHash keccak256(resource URL) binding payment → resource.
function settle(
    address from, address to, uint256 value,
    uint256 validAfter, uint256 validBefore,
    bytes32 nonce, bytes32 resourceHash,
    uint8 v, bytes32 r, bytes32 s
) external whenNotPaused {
    if (settlements[nonce].settledAt != 0) revert AlreadySettled(nonce);

    // Reverts inside USDC on bad signature, expired window or used nonce.
    usdc.transferWithAuthorization(
        from, to, value, validAfter, validBefore, nonce, v, r, s
    );

    settlements[nonce] = Settlement({
        payer: from,
        payTo: to,
        amount: value,
        resourceHash: resourceHash,
        settledAt: uint64(block.timestamp)
    });

    emit X402Settled(from, to, value, resourceHash, nonce);
}`,
      },
      {
        type: "ul",
        items: [
          "The facilitator holds no funds and no keys. The EIP-3009 signature is verified by USDC itself against the payer, so this contract adds zero trust assumptions — it physically cannot move money the payer did not authorize, and USDC's own nonce accounting makes every authorization single-use.",
          "Payments are bound to what they bought. resourceHash is the keccak256 of the resource URL, and every settlement is recorded on-chain and served back to agents via GET /api/x402/settlement/:tx — so an agent can later prove exactly which booking a payment paid for, something hosted facilitators do not give you.",
          "Fees are capped on-chain, not just in the API. The 0.5% fee is applied by our FurlPayRouter payment rail, whose contract hard-codes a 1% fee ceiling (MAX_FEE_BPS = 100) — whatever a compromised or misconfigured API might quote, the chain refuses anything above 1%.",
        ],
      },
      { type: "h2", text: "Gas benchmarks: why the paymaster model is sustainable" },
      {
        type: "p",
        text: `These are measured numbers from our Hardhat suite — 34 passing tests plus a mainnet-fork suite that validates the settlement paths against real Arbitrum One USDC and the Chainalysis sanctions oracle — compiled with solc 0.8.28, optimizer enabled:`,
      },
      {
        type: "table",
        headers: ["Operation", "Gas (measured)", "What it does"],
        rows: [
          ["X402Facilitator.settle", "202,667", "Agent payment: EIP-3009 USDC transfer + on-chain settlement record"],
          ["FurlPayRouter.pay", "129,240", "Signed EIP-712 payment: merchant gets amount minus fee, treasury gets fee, replay-safe"],
          ["FurlPayRouter.batchPay", "198,810 / batch", "Up to 100 payouts in one transaction (payroll, supplier runs)"],
          ["FurlPayEscrow.createBooking", "206,233", "Escrows the booking funds and mints the ERC-721 receipt NFT"],
        ],
      },
      {
        type: "p",
        text: `The paymaster math follows directly. On a $340 hotel booking, the 0.5% fee is $1.70 of USDC revenue. At Arbitrum One's typical base fee the 202,667-gas settle transaction costs around a cent, and single-digit cents even when gas spikes — roughly two orders of magnitude below the fee it earns. That margin is what lets us sponsor gas for every user and every AI agent rather than teaching travelers what ETH is. On Ethereum L1 the identical call would cost dollars at congested prices, which is why gas sponsorship for sub-$200 bookings only works on an L2: Arbitrum's cost structure is not a nice-to-have, it is what makes the business model function.`,
      },
      { type: "h2", text: "Why not just use Stripe?" },
      {
        type: "p",
        text: `It is the first question every investor asks, and it deserves a direct answer. [Stripe's stablecoin product charges a flat 1.5%](https://docs.stripe.com/payments/stablecoin-payments) and routes merchant payouts through the standard Stripe balance and payout cycle — a genuinely good product, priced to cover a fiat off-ramp and Stripe's margin. Furlpay charges 0.5% because we never leave the chain: USDC in, USDC out, settled on Arbitrum in seconds, with the fee ceiling enforceable by the merchant on-chain. That is not a pricing tactic — it is an architectural consequence of staying on-chain that a fiat-first processor cannot copy without rebuilding its settlement model.`,
      },
      {
        type: "table",
        headers: ["Dimension", "Stripe (stablecoin)", "Coinbase Commerce", "Furlpay"],
        rows: [
          ["Fee", "1.5% flat", "1%", "0.5% flat, 1% ceiling enforced on-chain"],
          ["Settlement", "Standard payout cycle (USD) or wallet payout", "On-chain", "~2 seconds on Arbitrum, booking-bound receipts"],
          ["AI agent support", "None native", "Basic crypto accept", "Native x402 + spend mandates + MCP tools"],
          ["Travel vertical", "No booking engine", "No booking engine", "2.2M+ stays and flights in-client"],
          ["Gas model", "N/A (off-chain)", "User pays gas", "Sponsored via paymaster"],
          ["Custody", "Processor-held balance", "Optional self-custody", "Always self-custody (smart accounts)"],
        ],
        highlightCol: 3,
      },
      {
        type: "p",
        text: `Coinbase Commerce is closer to our architecture but operates as a generic payment button with no vertical integration: it does not book hotels, does not issue spend mandates to AI agents, and does not bind receipts to bookings. Horizontal infrastructure captures thin protocol fees. Vertical infrastructure captures the full transaction stack.`,
      },
      { type: "h2", text: "Frictionless by design: passkeys and gas-free accounts" },
      {
        type: "p",
        text: `Web3 payments have historically failed on user experience: seed phrases, gas tokens and opaque wallet prompts are non-starters for a traveler at checkout. Furlpay removes all three. Accounts are ERC-4337 smart accounts created and approved with passkeys — WebAuthn credentials whose private keys live in the device's hardware secure enclave and unlock with FaceID or a fingerprint, making them phishing-resistant by construction. Gas is invisible: transactions route through a paymaster on Arbitrum, sponsored out of the merchant-side fee, so neither guests nor agents ever hold ETH. The result feels like Apple Pay and settles like a wire that clears in two seconds.`,
      },
      {
        type: "p",
        text: `The detail I spent the longest on was making "sign up and get paid" feel instant. A Furlpay account address is derived deterministically from the passkey's public key, so the address exists — and can receive USDC — before the smart-account contract is ever deployed; the first outgoing transaction triggers the actual counterfactual deployment. Getting that derivation stable across devices and credential re-registrations took longer than the payment rail itself, and it is exactly the kind of detail that separates a demo from a product.`,
      },
      { type: "h2", text: "Compliance as a moat, not a checkbox" },
      {
        type: "p",
        text: `Payments infrastructure does not get to route around regulation — and in 2026 the rulebook finally crystallized, which favors builders who engineered for it early. In the US, the [GENIUS Act was signed in July 2025 and final implementing regulations are due by July 18, 2026](https://www.paulhastings.com/insights/crypto-policy-tracker/the-genius-act-a-comprehensive-guide-to-us-stablecoin-regulation), giving payment stablecoins a federal prudential framework. In Japan, the JFSA's mid-2026 electronic payment instrument approvals opened a [licensed USDC-settlement pathway via SBI VC Trade](/blog/leap-east-2026-hong-kong-stablecoin-agentic-payments). We design for the UK FCA's e-money regime, Dubai's VARA framework and Saudi Arabia's SAMA cashless-vision programs from day one, routing each payment through the disclosure regime its corridor requires — and we will be in Riyadh for [Money20/20 Middle East](https://money2020middleeast.com/) this September.`,
      },
      {
        type: "p",
        text: `Just as important is what we do not do: Furlpay never takes custody of customer deposits. Balances live in non-custodial smart accounts and 2-of-2 MPC vaults; we act strictly as an on-chain routing and settlement utility. That architecture cuts our regulatory surface dramatically while guaranteeing users self-custody — the same property that lets AI agents transact under [cryptographically bound spend mandates](https://github.com/FurlPay/agent-trust) (budget caps, merchant allowlists, expiry) without ever touching a master key.`,
      },
      { type: "h2", text: "The investment case: vertical integration wins" },
      {
        type: "p",
        text: `Venture capital has funded horizontal agent-payment protocols generously. But horizontal infrastructure only captures value when vertical applications drive real-world volume through it — and travel is the deepest consumer vertical there is. Furlpay owns the full loop in one client: stablecoin checkout, a travel engine with 2.2M+ stays and flights, and a USDC-funded investing hub.`,
      },
      {
        type: "ul",
        items: [
          "A 0.5% checkout take rate on every stablecoin payment routed through the facilitator.",
          "2-5% travel commission on each hotel or flight booked through the aggregated inventory.",
          "x402 paywall hosting fees from developers selling API access to AI agents via our MCP server.",
        ],
      },
      {
        type: "p",
        text: `Three revenue engines compound inside a single transaction loop. As stablecoins absorb global money movement and autonomous agents scale from 69,000 to millions, the platforms that win will be the ones already routing real bookings, for real merchants, under real regulatory frameworks.`,
      },
      {
        type: "quote",
        text: `Cards taxed the travel industry 3% for fifty years because there was no alternative rail. For humans and machines alike, there is now.`,
      },
      {
        type: "p",
        text: `Furlpay is launching its developer sandbox and raising a seed round to fund our first hotel pilots. Our smart contracts and SDKs are open source on [GitHub](https://github.com/Ashutosh0x/furlpay), the [developer docs](/docs) cover the x402 integration end to end, and you can reach me directly at [founder@furlpay.com](mailto:founder@furlpay.com) or via [talk to us](/talk-to-us).`,
      },
    ],
  },
  // LEAP East 2026 — APAC stablecoin & agentic payments analysis --------
  {
    slug: "leap-east-2026-hong-kong-stablecoin-agentic-payments",
    title: "LEAP East 2026: Hong Kong Just Became the Test Bed for Stablecoin Settlement and Agent Payments",
    excerpt:
      "The Saudi-backed LEAP exhibition opened its first international edition in Hong Kong this week — and the agenda reads like a roadmap for regulated stablecoin money movement in APAC. Licensed issuers, Japan's newly approved JPYSC and RLUSD, and AI agents paying per request: here is what it means, and where Furlpay's rails fit.",
    category: "compliance",
    date: "2026-07-08",
    readMins: 7,
    author: "Furlpay Team",
    body: [
      {
        type: "p",
        text: `LEAP East 2026 opened this week at the Hong Kong Convention and Exhibition Centre — the [first international edition](https://onegiantleap.com/Leap-in-the-news/leap-takes-giant-stride-inaugural-leap-east-confirmed-hong-kong-july-2026) of the Saudi-backed LEAP technology exhibition, running 8-10 July with hundreds of speakers and exhibitors across fintech, AI and Web3. The location is not incidental. Hong Kong has spent the past year building the most explicit regulatory on-ramp for stablecoin issuers anywhere in Asia, and the conference agenda — settlement infrastructure, tokenized deposits, agentic commerce — reads like a public roadmap for where regulated crypto payments go next.`,
      },
      { type: "h2", text: "The regulatory scaffolding is real now" },
      {
        type: "p",
        text: `Hong Kong's [Policy Statement 2.0 on digital assets](https://www.info.gov.hk/gia/general/202506/26/P2025062600269.htm) introduced the LEAP framework — legal streamlining, expanded tokenized products, advancing use cases, and people/partnership development — with a unified licensing regime covering exchanges, stablecoin issuers, dealers and custodians. In March 2026 that framework produced its first concrete output: the HKMA [granted the first stablecoin issuer licenses](https://www.coindesk.com/policy/2026/03/24/hong-kong-awards-first-stablecoin-licenses-to-hsbc-standard-chartered-led-group) to HSBC and to Anchorpoint Financial, a Standard Chartered-led venture that includes Animoca Brands. Bank-issued, reserve-audited stablecoins are no longer a consultation paper in Hong Kong; they are licensed products.`,
      },
      {
        type: "p",
        text: `Japan reached the same milestone weeks earlier by a different route. The JFSA approved Ripple's RLUSD as the country's first "Type 4" electronic payment instrument, [live via SBI VC Trade since late June](https://www.coindesk.com/markets/2026/06/25/ripple-s-rlusd-stablecoin-goes-live-in-japan-after-regulatory-approval) (Ethereum-only, capped at roughly ¥1M per transaction), while SBI's yen-denominated JPYSC launched uncapped for institutional settlement. Two of Asia's three largest financial centers now have licensed stablecoins issued by or with major banks — a template the rest of APAC can copy.`,
      },
      { type: "h2", text: "From pilots to systems" },
      {
        type: "p",
        text: `The recurring theme on the LEAP East stage is the shift from experimental pilots to a systems phase: stablecoins as standard settlement infrastructure alongside ACH and SWIFT, not a parallel curiosity. That matches what we see on the merchant side. Cross-border settlement in USDC clears in seconds for cents, every payment carries an on-chain receipt, and treasury teams get reconciliation for free. The blocker was never the technology — it was the absence of licensed issuers and clear supervisory expectations. That blocker is now being removed jurisdiction by jurisdiction.`,
      },
      {
        type: "ul",
        items: [
          "Licensed issuance: HSBC and Anchorpoint in Hong Kong; RLUSD and JPYSC under the JFSA in Japan.",
          "Unified VASP licensing under the LEAP framework, covering custody and dealing, not just exchanges.",
          "Sandboxes for tokenized deposits, letting banks settle on-chain under regulatory supervision.",
        ],
      },
      { type: "h2", text: "The second story: machines that pay" },
      {
        type: "p",
        text: `The other dominant track is autonomous commerce. With open protocols like x402 for pay-per-request APIs and AP2 for agent payment mandates, AI agents can now hold budgets and settle nanopayments — fractions of a cent for compute, data feeds and API calls — on low-latency L2 chains like Base and Arbitrum. The critical design pattern discussed across panels is the pre-authorized spending mandate: cryptographically bound limits (budget, merchant category, expiry) that let an agent transact without ever touching a master key.`,
      },
      {
        type: "p",
        text: `This is precisely the architecture Furlpay ships today. [@furlpay/agent-trust](https://github.com/FurlPay/agent-trust) implements user-signed spend mandates — max total, max per booking, merchant allowlists, expiry, single-use — with RFC 9421 HTTP signatures, and [x402-guard](https://github.com/FurlPay/x402-guard) hardens the settlement path against the known free-riding attack classes. Our CLI's MCP server, now listed on the [official MCP Registry](https://registry.modelcontextprotocol.io), gives any AI agent 18 financial tools: balances, transfers, swaps, fractional stock orders, travel booking and yield deposits, all settling in USDC.`,
      },
      { type: "h2", text: "What we take home from it" },
      {
        type: "table",
        headers: ["LEAP East 2026 trend", "Furlpay alignment"],
        rows: [
          ["APAC licensed-stablecoin corridors", "USDC-native settlement on Arbitrum and Base, FX-aware routing"],
          ["Tokenized-deposit sandboxes", "Safe/ERC-4337 smart accounts via the Account Kit"],
          ["Agentic micropayments (x402, AP2)", "MCP server, agent-trust mandates, x402-guard"],
          ["Verifiable settlement", "On-chain receipt for every payment"],
        ],
        highlightCol: 1,
      },
      {
        type: "p",
        text: `Our read: the compliance-aware corridor is the product. As JPYSC, RLUSD and Hong Kong's licensed issuers come online, the winners will be platforms that can route a payment through the right stablecoin, the right chain and the right disclosure regime automatically — for humans and for their agents. That routing layer is what we build. If you are working on APAC settlement or agent payments, [talk to us](/talk-to-us) or start with the [developer docs](/docs).`,
      },
      {
        type: "quote",
        text: `Hong Kong spent two years writing the rulebook. LEAP East is the moment the industry showed up to play by it.`,
      },
    ],
  },
  // Trip.com stablecoins — timely news post -----------------------------
  {
    slug: "trip-com-stablecoin-payments-what-it-signals",
    title: "Trip.com Now Takes Stablecoins — What It Signals for Travel Payments in 2026",
    excerpt:
      "Trip.com added USDT/USDC checkout in 2026, joining Travala, Wego and Meta's creator payouts in a broad shift to stablecoin money movement. Here is what changed, why it matters, and where Furlpay fits — USDC-native settlement, agentic booking, and a single-use Visa card for merchants that still take fiat only.",
    category: "travel",
    date: "2026-07-07",
    readMins: 7,
    author: "Furlpay Team",
    featured: true,
    body: [
      {
        type: "p",
        text: `Stablecoin payments reached mainstream travel in 2026. Trip.com — one of the world's largest online travel agencies — integrated stablecoin checkout, letting travelers pay for global flights and hotels in USDT and USDC. It is the clearest signal yet that paying for travel with dollar-stable crypto is no longer a niche: it is becoming a standard payment option at the top of the industry.`,
      },
      { type: "h2", text: "What Trip.com announced" },
      {
        type: "p",
        text: `Trip.com [officially integrated stablecoin payments](https://www.okx.com/en-us/learn/trip-com-launches-stablecoin-payments-for-global-travel-bookings), allowing users worldwide to pay for flights and hotels using USDT and USDC. It follows a wave of the same move across the sector: [Wego added USDC, USDT, PYUSD and EURC](https://blog.wego.com/stablecoins-for-travel/) for flights and hotels, and [Travala now accepts 27 coins including USDC on Base](https://coinmarketcap.com/academy/article/travalas-travel-mcp-brings-ai-hotel-booking-to-base-with-usdc) with an AI booking protocol settling over the x402 standard.`,
      },
      {
        type: "p",
        text: `The context is bigger than travel. In April 2026, [Meta began paying creators in USDC](https://www.coindesk.com/business/2026/04/29/tech-giant-meta-starts-paying-some-creators-in-stablecoin-with-stripe-s-support) via Stripe on Solana and Polygon, with a rollout planned across roughly 160 countries. When the largest OTAs and the largest social platform both move money in stablecoins in the same year, the direction is set.`,
      },
      { type: "h2", text: "Why it matters" },
      {
        type: "p",
        text: `Stablecoins fix problems that fiat travel rails were never built for. Cross-border payments settle in seconds instead of days, without wire fees or exchange-rate friction. Payouts reach anyone with a wallet, regardless of local banking. And when settlement happens on-chain, every payment carries a verifiable receipt — useful for expenses, reconciliation, and attribution disputes.`,
      },
      {
        type: "p",
        text: `Agentic commerce is accelerating the same shift. The total value of agentic transactions is [projected to reach $8 billion in 2026](https://www.investing.com/news/cryptocurrency-news/travala-launches-worlds-first-endtoend-agentic-ai-travel-protocol-4741454) and scale toward an estimated $3.5 trillion by 2031. AI agents cannot fill in a card form and wait three days for settlement — they need internet-native, pay-per-request money. That is exactly what stablecoins over x402 provide.`,
      },
      {
        type: "table",
        headers: ["Platform", "Stablecoins accepted", "On-chain settlement"],
        rows: [
          ["Trip.com", "USDT / USDC (2026)", "Off-chain processor"],
          ["Travala", "27 coins incl. USDC on Base", "USDC on Base"],
          ["Wego", "USDC / USDT / PYUSD / EURC", "Off-chain processor"],
          ["Booking.com · Expedia · Airbnb", "Fiat only (no direct crypto)", "No"],
          ["Furlpay", "USDC-native + single-use Visa VCN", "USDC on Arbitrum, receipt"],
        ],
        highlightCol: 2,
      },
      { type: "h2", text: "Where Furlpay fits" },
      {
        type: "p",
        text: `Most OTAs that "accept stablecoins" bolt a crypto checkout onto a fiat processor. Furlpay is built the other way around: USDC is the settlement currency, so every booking on 2.2M+ stays and flights returns an Arbiscan-verifiable receipt. For any merchant that still takes cards only — an airline, a hotel chain, an Airbnb host — Furlpay issues a [single-use, MCC-locked Visa virtual card](/compare/airbnb) funded by your USDC, so your stablecoins reach merchants with no crypto integration at all.`,
      },
      {
        type: "p",
        text: `It is also agentic by default: an AI agent can search and book travel and pay per resource over x402 within a user-signed budget. And it turns the creator side of travel into stablecoin income — the [Furlpay Creator Program](/ambassadors) pays up to 10% in USDC weekly with no minimum payout, a 90-day cookie, and 2% USDC cashback for followers. Compare the details on our [Furlpay vs Trip.com](/compare/trip-com) and [Furlpay vs Booking.com](/compare/booking-com) pages.`,
      },
      {
        type: "quote",
        text: `The question in 2026 is no longer whether travel takes stablecoins — Trip.com, Travala and Wego already do. It is whether payments settle on-chain, work for AI agents, and pay creators fairly. That is the layer Furlpay is built for.`,
      },
    ],
  },
  // 0 -----------------------------------------------------------------
  {
    slug: "why-we-built-furlpay-stablecoins-agents-arbitrum",
    title: "Why We Built Furlpay Around Stablecoin Payments, AI Agents and Arbitrum",
    excerpt:
      "Merchant payment fees run 1.5-3.5% on card rails. Stablecoin payments on Arbitrum cost a fraction of that — and the industry's biggest players are moving the same direction. Here is the thesis behind Furlpay, what we have built so far, and where we fit in the payments landscape.",
    category: "product-news",
    date: "2026-07-05",
    readMins: 8,
    author: "Furlpay Team",
    body: [
      {
        type: "p",
        text: `Furlpay is a stablecoin payments, travel and investing platform. You can book from 2.2M+ hotels and flights, pay in USDC, and hold a portfolio — in one app, secured by passkeys instead of seed phrases. Under the hood, every payment settles on Arbitrum, and every API we expose can be called and paid for by an AI agent as easily as by a person.`,
      },
      {
        type: "p",
        text: `We did not arrive at this stack by accident. Over the past eighteen months, the largest names in payments have been converging on the same ingredients: Mastercard brought [24/7 stablecoin settlement to Arbitrum](https://blog.arbitrum.foundation/), Robinhood launched [its own chain on Arbitrum Orbit](https://robinhoodchain.blockscout.com), Coinbase created the [x402 payment protocol](https://docs.cdp.coinbase.com/x402/welcome) for AI agents, and Visa is building agent-trust infrastructure with [Cloudflare](https://developers.cloudflare.com/agents/agentic-payments/x402/). These moves validate a broader trend: programmable payments and stablecoin infrastructure are going mainstream. Furlpay is built for that same direction — focused on combining payments, travel and investing into a single consumer product.`,
      },
      { type: "h2", text: "The problem: merchant payment fees on card rails" },
      {
        type: "p",
        text: `When a customer pays $150 by card, the merchant typically receives $144.75 to $147.75. The difference — interchange, network assessments and acquirer margin — usually lands between 1.5% and 3.5%, and it funds rewards programs, fraud losses and several layers of intermediaries.`,
      },
      {
        type: "p",
        text: `A stablecoin transfer has none of those layers. The money moves directly from payer to merchant on-chain. On Arbitrum, the entire cost is Furlpay's 0.5% fee plus roughly half a cent of gas.`,
      },
      {
        type: "table",
        headers: ["Rail", "Cost on $150", "Rate"],
        rows: [
          ["Cards (typical range)", "$2.25 - $5.25", "1.5% - 3.5% merchant discount"],
          ["Coinbase Commerce", "$1.50", "1% flat"],
          ["Furlpay (USDC on Arbitrum)", "$0.75", "0.5% + ~$0.004 gas"],
        ],
        highlightCol: 0,
      },
      {
        type: "p",
        text: `The Furlpay figure is live, not projected — you can query it right now at [furlpay.com/api/payments/fees/estimate](https://furlpay.com/api/payments/fees/estimate?amount=150). Card figures are typical merchant discount ranges based on public information; actual pricing varies by issuer, category and geography. For a travel merchant on ten-percent margins, the gap is a meaningful share of the profit on every booking.`,
      },
      { type: "h2", text: "What we built: stablecoin payments with a 0.5% fee" },
      {
        type: "p",
        text: `Our payments API creates a quote, hands the payer's wallet an EIP-712 authorization to sign, screens both sides against sanctions lists, and settles in USDC on Arbitrum One. Receipts link straight to Arbiscan.`,
      },
      {
        type: "ul",
        items: [
          `Compliance before the chain — KYC tiers, sanctions screening on both legs of every payment, FATF Travel Rule payloads and MiCA-aware jurisdiction rules run server-side before any transaction is submitted.`,
          `A hard ceiling in the contract — our router is designed to refuse any fee above 1% on-chain, whatever the API quotes, so the trust boundary is cryptographic rather than organizational.`,
          `Batch payouts, refunds and a public fee estimator round out the merchant surface.`,
        ],
      },
      { type: "h2", text: "Agentic commerce: AI agents as paying customers" },
      {
        type: "p",
        text: `The fastest-growing payments customer of 2026 is not a person. The [x402 protocol](https://www.x402.org/) revives HTTP's 402 status code so an AI agent can pay per request in USDC — no account, no card on file. Coinbase and Cloudflare created it, and adoption has been rapid across Base and Solana.`,
      },
      {
        type: "p",
        text: `Furlpay runs its own x402 facilitator on Arbitrum, Base and Solana. We designed it around the attack classes documented in recent x402 security research (see ["Free-Riding the Agentic Web"](https://arxiv.org/abs/2605.30998)): quotes are cryptographically bound to the resource they price, nonces are single-use, and malformed payment headers fail closed. Agents discover what Furlpay sells through our resource catalog and MCP servers, and can search, book and pay for travel autonomously.`,
      },
      {
        type: "p",
        text: `We are not alone here, and that is the point. Visa's Trusted Agent Protocol and Mastercard's Agent Pay bring agents to card rails; Coinbase operates a hosted facilitator across several chains. Agentic payments is the youngest layer of the stack — positions are far from settled, and we believe a focused, security-first implementation can be genuinely competitive.`,
      },
      { type: "h2", text: "Why Arbitrum" },
      {
        type: "p",
        text: `Arbitrum One offers deep stablecoin liquidity, sub-cent transaction fees with predictable gas pricing after the [ArbOS Dia upgrade](https://docs.arbitrum.io/run-arbitrum-node/arbos-releases/overview), and Ethereum-grade security. It is also where institutional settlement is consolidating — the same rail Mastercard chose for stablecoin settlement and Robinhood chose for its tokenized-stock chain.`,
      },
      {
        type: "p",
        text: `Our smart contracts — a payment router, an x402 settlement facilitator, a travel booking escrow and ERC-721 booking receipts — are [open source on GitHub](https://github.com/Ashutosh0x/furlpay) with a passing test suite, heading to Arbitrum Sepolia next. Renting block space on Arbitrum rather than running our own chain keeps our costs near zero while we grow; the option to graduate to a dedicated Orbit chain later stays open.`,
      },
      { type: "h2", text: "Where Furlpay fits in the payments landscape" },
      {
        type: "p",
        text: `We are not trying to replace card networks, exchanges or brokerages — they serve billions of people well. Our observation is simpler: few platforms combine real-world commerce, agentic payments and compliance-first stablecoin rails in a single product, and we believe that whitespace is worth building into.`,
      },
      {
        type: "table",
        headers: ["Layer", "Established players", "Furlpay's approach"],
        rows: [
          [
            "Merchant payments",
            "Card networks settle between banks at a 1.5-3.5% merchant cost",
            "Direct USDC settlement on Arbitrum at 0.5% + gas",
          ],
          [
            "Agentic payments",
            "Visa TAP and Mastercard Agent Pay extend card rails; Coinbase hosts an x402 facilitator",
            "Self-hosted x402 facilitator hardened against published attack classes, with agent spend mandates",
          ],
          [
            "Consumer product",
            "Exchanges trade crypto; brokerages trade stocks; travel platforms take cards",
            "Travel, investing and payments in one passkey-secured app, bookable by humans or agents",
          ],
          [
            "Developer platform",
            "Enterprise onboarding at the networks; strong self-serve tooling at Coinbase",
            "Open APIs, SDKs in four languages, MCP servers and MIT-licensed packages",
          ],
        ],
        highlightCol: 2,
      },
      { type: "h2", text: "What we are honest about" },
      {
        type: "p",
        text: `Furlpay is early. The product is live at furlpay.com with real authentication and real APIs, but several integrations run in demo mode, our contracts are tested rather than deployed, and we have no payment volume yet. The incumbents have distribution, licenses and balance sheets we do not.`,
      },
      {
        type: "p",
        text: `What we have is speed, focus and timing. The proof points ahead of us, in order: deploy the contracts to Arbitrum Sepolia and then Arbitrum One; complete a real end-to-end agentic booking — agent finds a hotel via MCP, pays via x402, escrow releases on-chain, receipt minted; and sign a first design partner who accepts USDC through the merchant rail.`,
      },
      { type: "h2", text: "Try it" },
      {
        type: "ul",
        items: [
          `Explore travel with USDC checkout at [furlpay.com/travel](/travel).`,
          `Building something? Start at the [developer portal](/developer) and the [docs](/docs).`,
          `Query the live fee estimator: [furlpay.com/api/payments/fees/estimate?amount=150](https://furlpay.com/api/payments/fees/estimate?amount=150).`,
          `Read the contracts and SDKs [on GitHub](https://github.com/Ashutosh0x/furlpay).`,
          `Talk to us directly — [furlpay.com/talk-to-us](/talk-to-us). We will be at the Arbitrum Open House in London, July 10-12.`,
        ],
      },
    ],
  },
  {
    slug: "integrating-furlpay-with-arbitrum",
    title: "Integrating Furlpay with Arbitrum: Payments, x402 and Contracts on the Largest L2",
    excerpt:
      "Furlpay's settlement stack is going Arbitrum-first. Here is exactly what we shipped — an x402 facilitator that settles on Arbitrum, a unified USDC payments API, a chain registry, and four Solidity contracts with a green 17-test suite — and what ships next.",
    category: "engineering",
    date: "2026-07-05",
    readMins: 9,
    author: "Furlpay Engineering",
    featured: true,
    body: [
      {
        type: "p",
        text: `Arbitrum One has quietly become the institutional settlement layer of Ethereum. The network has processed over 2.1 billion lifetime transactions, secures roughly $20B in value, and holds the deepest stablecoin liquidity of any L2 — which is why Mastercard chose it for 24/7 stablecoin settlement and why Robinhood built its tokenized-stock chain on Arbitrum Orbit. January's ArbOS "Dia" upgrade added predictable gas pricing on top. For a payments company whose pitch is "0.5% USDC rails instead of 3.5% card interchange," this is the rail you settle on.`,
      },
      {
        type: "p",
        text: `This week we made Furlpay Arbitrum-first. This post is the engineering log: what shipped, how it fits together, and what is still in front of us before the Arbitrum Open House in London (July 10-12).`,
      },
      { type: "h2", text: "What shipped: the API layer" },
      {
        type: "ul",
        items: [
          `x402 on Arbitrum — our facilitator now verifies and settles agentic payments on arbitrum and arbitrum-sepolia alongside Base and Solana, and quotes default to native USDC on Arbitrum One (0xaf88...5831). The hardening we published in "Five Ways to Rob an AI Agent" carries over unchanged: HMAC-bound quotes, single-use nonces, strict web-layer parsing.`,
          `A unified payments API — POST /api/payments/create returns a 0.5% fee quote plus EIP-712 typed data; /execute verifies the payer's signature, screens both parties against sanctions lists, and settles on Arbitrum One. Receipts link straight to Arbiscan. Batch, refund, history and a public fee estimator round out the surface.`,
          `A chain registry — /api/chain/status, /gas-price, /contracts, /usdc/supply and /tx lookups across Arbitrum One (42161), Arbitrum Sepolia (421614), Robinhood Chain (4663), Base and Ethereum. Mock-first, so the whole stack runs with zero credentials; flip INTEGRATION_MODE=live for real JSON-RPC.`,
          `An x402 resource catalog — agents can now discover what Furlpay sells (GET /api/x402/resources), quote any resource without triggering a 402 (/price), and confirm settlements (/settlement/:tx). Third-party servers onboard their own priced endpoints via /register.`,
        ],
      },
      { type: "h2", text: "What shipped: the contracts" },
      {
        type: "p",
        text: `Four Solidity contracts, OpenZeppelin 5 throughout, compiled for the Cancun EVM target Arbitrum supports, with a 17-test suite covering the full lifecycle of each — payments, replays, expiry, wrong-signer rejection, fee ceilings, escrow release and refund paths, and EIP-3009 settlement.`,
      },
      {
        type: "diagram",
        text: `apps/web (Next.js API)                    packages/contracts (Arbitrum One)
POST /api/payments/create  ── EIP-712 ──>  FurlPayRouter.pay()      0.5% fee, nonce replay guard
POST /api/x402/facilitator/settle ──────>  X402Facilitator.settle() EIP-3009, resource-bound log
POST /api/travel/bookings  ─── USDC ───>   FurlPayEscrow            oracle release / timed refund
                                     └──>  BookingReceipt (ERC-721) minted to the traveler`,
      },
      {
        type: "ul",
        items: [
          `FurlPayRouter — a payer signs a Payment authorization off-chain (the exact typed data our API already emits); a relayer submits it. The merchant receives amount minus fee, the treasury accrues the fee, and the contract enforces a hard 1% fee ceiling on-chain regardless of what any API quotes. Nonces are single-use; authorizations expire.`,
          `X402Facilitator — forwards EIP-3009 transferWithAuthorization to USDC, so the facilitator never holds funds or keys, then writes an indexed settlement record binding the payment to a hash of the resource it bought. Coinbase's hosted facilitator and PayAI already settle x402 on Arbitrum; ours differs by indexing settlements on-chain and binding them to resources, which is what /api/x402/settlement serves back to agents.`,
          `FurlPayEscrow — travel bookings fund in USDC and release on oracle-confirmed check-in, refund inside the cancellation window, or release permissionlessly after a 7-day grace period so providers are never hostage to a dead oracle.`,
          `BookingReceipt — an ERC-721 minted on funding whose tokenId is the booking id, so proof-of-purchase is verifiable straight from the booking reference.`,
        ],
      },
      { type: "h2", text: "Design decisions worth stealing" },
      {
        type: "ul",
        items: [
          `Sign off-chain, settle on-chain. Users and agents never pay gas to authorize; a relayer batches submissions. Arbitrum's post-Dia fee floor makes the relayer's cost per settlement fractions of a cent.`,
          `Compliance before the chain. Both legs of every payment pass sanctions screening server-side before any transaction is submitted — the same pattern institutional settlers use, and the reason the contract layer can stay simple.`,
          `Fee ceilings belong on-chain. The API quotes 0.5%, but the router refuses anything above 1% cryptographically. If our API is ever compromised, the blast radius is bounded by the contract.`,
          `Mock-first infrastructure. Every endpoint runs deterministically with zero credentials and switches to live RPC with one environment variable. Demos never depend on testnet faucets cooperating.`,
        ],
      },
      { type: "h2", text: "What is left" },
      {
        type: "ul",
        items: [
          `Deploy to Arbitrum Sepolia, then One — the deploy script already prints the FURLPAY_* environment variables the web app reads; the contract directory flips from "pending deployment" to live addresses the moment they exist.`,
          `The relayer — a small service that takes executed API payments and submits them to FurlPayRouter, completing the off-chain-to-on-chain loop.`,
          `Merchant API and compliance endpoints — checkout sessions, payouts, webhooks, and public sanctions-screening routes on top of the screening engine that already guards /execute.`,
          `ERC-4337 passkey wallets — our WebAuthn authentication already exists; wiring it to a smart account with a USDC paymaster removes the last piece of gas UX entirely.`,
          `The Orbit question — Robinhood validated launch-on-One, migrate-to-Orbit. If Furlpay's settlement volume justifies a dedicated chain with compliance hooks at the sequencer level, the Nitro stack is the obvious path.`,
        ],
      },
      {
        type: "p",
        text: `The pattern behind all of it: stablecoin settlement is consolidating on Arbitrum, agentic payments are consolidating on x402, and Furlpay sits at the intersection — the payment rail where both humans and machines transact, with compliance built in rather than bolted on. If you are at the Open House in London, come find us; the contracts will be on Sepolia by then.`,
      },
    ],
  },
  {
    slug: "five-ways-to-rob-an-ai-agent-securing-x402",
    title: "Five Ways to Rob an AI Agent: How Furlpay Hardens x402 Payments",
    excerpt:
      "x402 moves ~$600M a year in agentic USDC payments — and 2026 security research documents attack classes most implementations don't defend. Here's how Furlpay's pay-per-call API closes authorization, binding, replay, and web-layer holes.",
    category: "security",
    date: "2026-07-02",
    readMins: 7,
    author: "Furlpay Security",
    body: [
      {
        type: "p",
        text: `The most interesting payments customer of 2026 isn't a person — it's an AI agent. The x402 protocol (created by Coinbase and Cloudflare) revives HTTP's long-dormant 402 "Payment Required" status code so any agent, script, or API client can pay per-request in USDC: no account, no API key, no card on file. Adoption has been explosive — over 119 million transactions on Base and 35 million on Solana, roughly $600M in annualized volume, with Google (AP2), Stripe/Tempo (MPP), and Visa (TAP) all racing to ship competing agentic-payment standards.`,
      },
      {
        type: "p",
        text: `But speed of adoption has outrun security. Three 2026 research papers — "Five Attacks on x402" (arXiv:2605.11781), "Free-Riding the Agentic Web" (arXiv:2605.30998), and "Hardening x402" (arXiv:2604.11430) — document concrete, working attacks against naive x402 servers across four weakness classes: authorization, binding, replay protection, and web-layer handling. Most implementations in the wild defend none of them.`,
      },
      { type: "h2", text: "The four weakness classes" },
      {
        type: "ul",
        items: [
          `Authorization — servers that trust fields echoed back by the client (amount, recipient, network) can be paid $0.000001 for a $10 resource, or paid on the wrong chain entirely.`,
          `Binding — a payment authorized for one resource is presented to unlock a different, more expensive one, because nothing ties the signed authorization to the specific URL and method it was quoted for.`,
          `Replay — a single signed EIP-3009 authorization is redeemed repeatedly against servers that don't track nonces, turning one $0.01 payment into unlimited API calls.`,
          `Web-layer — oversized or malformed X-PAYMENT headers crash naive parsers into failure modes that leak the resource without payment.`,
        ],
      },
      { type: "h2", text: "How Furlpay's x402 endpoint closes them" },
      {
        type: "p",
        text: `We shipped our first agentic pay-per-call API — GET /api/x402/fx, a mid-market FX quote for $0.01 USDC per call — with all four classes defended by construction, not by review checklist.`,
      },
      {
        type: "diagram",
        text: `[ Agent GET /api/x402/fx ] ──> 402 + quote (HMAC-bound to resource+method+amount+expiry)
[ Agent signs EIP-3009 ]  ──> retry with X-PAYMENT header
[ Furlpay verifies ]      ──> exact-match amount/recipient/network · binding MAC · single-use nonce ──> 200 + receipt`,
      },
      {
        type: "ul",
        items: [
          `Server-side truth: every field of the presented payment is compared against the server's own quote. The client's copy of the requirements is never trusted.`,
          `Cryptographic binding: each 402 quote carries an HMAC over (resource, method, amount, quoteId, expiry). A payment bound to one endpoint fails closed on every other endpoint — and tampered quotes fail the timing-safe MAC comparison.`,
          `Single-use everything: quoteIds and EIP-3009 nonces are burned on first redemption, and quotes expire in 300 seconds. Replays are rejected with an explicit "already redeemed" error.`,
          `Strict web layer: the X-PAYMENT header is size-capped before parsing, malformed input returns 400 — never a 500, never a free resource.`,
        ],
      },
      { type: "h2", text: "Why this matters for the agentic web" },
      {
        type: "p",
        text: `Agentic commerce only works if machine payments are safe for the seller as well as the buyer. Every attack above steals from the API provider — quietly, at machine speed, thousands of times per minute. As x402 volume compounds and AP2, MPP, and TAP arrive, the platforms that win won't be the ones that added a 402 handler first; they'll be the ones that made machine-speed money movement boring and safe. That's the standard we're building Furlpay to.`,
      },
      {
        type: "quote",
        text: `Auth for humans is a login. Auth for agents is the payment itself — which makes payment verification your entire security boundary.`,
      },
      {
        type: "p",
        text: `Try it: curl https://furlpay.com/api/x402/fx — you'll get a 402 quote back. The full hardened verifier ships in our monorepo, and a spec-correct Solana Actions template is open source at github.com/FurlPay.`,
      },
    ],
  },
  // 1 -----------------------------------------------------------------
  {
    slug: "announcing-furlpay-connect",
    title: "Announcing Furlpay Connect: B2B Stablecoin Settlement",
    excerpt:
      "A single-integration gateway that slashes merchant settlement fees to a flat 0.5% and deposits local currency straight into your bank account.",
    category: "product-news",
    date: "2026-07-01",
    readMins: 4,
    author: "Furlpay Team",
    featured: true,
    body: [
      {
        type: "p",
        text: `Traditional merchant payment gateways are built on legacy 1970s rails. Between interchange fees, merchant discount rates (MDR) and chargeback liabilities, businesses routinely surrender 2.5% to 4.0% of their top-line revenue just to process digital card payments. Today, we're launching Furlpay Connect — a single-integration gateway that slashes settlement fees to a flat 0.5% and deposits local currency directly into your bank account.`,
      },
      { type: "h2", text: "How it works" },
      {
        type: "p",
        text: `Furlpay Connect sits between high-speed Layer 2 blockchains (Base, Solana, Arbitrum) and domestic bank routing networks (ACH, SEPA, RTP). When a customer checks out:`,
      },
      {
        type: "ul",
        items: [
          `They sign a transaction using their Furlpay Passkey.`,
          `Stablecoins (USDC or EURC) are instantly transferred to Furlpay's liquidity pool.`,
          `Our backend automatically triggers a local payout through the Bridge.xyz API, depositing domestic currency into the merchant's bank account in seconds.`,
        ],
      },
      {
        type: "diagram",
        text: `[ Customer Wallet ] ──(0.5% fee)──> [ Furlpay Pool ] ──(local rail)──> [ Merchant Bank Account ]`,
      },
      { type: "h2", text: "Why it wins" },
      {
        type: "ul",
        items: [
          `Near-zero fees: cut merchant discount fees by up to 80%.`,
          `Zero volatility: merchants receive settlement in USD, EUR or GBP, shielded from asset volatility.`,
          `Frictionless integration: drop Connect into your checkout with a single script tag or our headless TypeScript SDK.`,
        ],
      },
    ],
  },

  // 2 -----------------------------------------------------------------
  {
    slug: "designing-2of2-mpc-key-generation",
    title: "Designing 2-of-2 MPC Key Generation for Self-Custody",
    excerpt:
      "No single private key is ever generated. Here's how Furlpay splits signing across a device passkey share and an HSM policy share.",
    category: "engineering",
    date: "2026-06-28",
    readMins: 6,
    author: "Security Engineering",
    body: [
      { type: "h2", text: "The security dilemma" },
      {
        type: "p",
        text: `In Web3, users historically faced a harsh choice: trust a centralized exchange with their keys (custodial) or write down a 12-word seed phrase on paper (self-custodial). The former exposes users to exchange insolvency; the latter places the entire burden of key security on the user, leading to millions lost to misplaced papers and phishing attacks. Furlpay solves this by implementing 2-of-2 Multi-Party Computation (MPC).`,
      },
      { type: "h2", text: "Under the hood: key splitting" },
      {
        type: "p",
        text: `With MPC, a single private key is never generated in one place. Instead, during account setup, our backend runs a cryptographic protocol (distributed key generation) to produce two distinct key shares:`,
      },
      {
        type: "ul",
        items: [
          `Share A (client-side): stored on the user's device, encrypted and accessible only via WebAuthn / passkey biometrics.`,
          `Share B (server-side): managed inside Furlpay's Hardware Security Module (HSM) cluster, gated by policy rules.`,
        ],
      },
      {
        type: "diagram",
        text: `[ Client Device ] ─────> Share A  (biometric-gated)
                            │
                     (co-signing engine)
                            │
[ Furlpay HSM ]   ─────> Share B  (policy rules)`,
      },
      {
        type: "p",
        text: `To sign a transaction, the client app and the Furlpay HSM compute a signature cooperatively. Neither party ever reveals its share, and the complete private key is never assembled in memory. If our server is breached, the attacker cannot steal your funds because they lack Share A. If you lose your device, Furlpay assists recovery through a secure social/email verification protocol to regenerate your key shares.`,
      },
      {
        type: "quote",
        text: `Compromising one share yields nothing usable — an attacker must defeat both the device and the HSM policy at the same time.`,
      },
    ],
  },

  // 3 -----------------------------------------------------------------
  {
    slug: "navigating-mica-auto-swaps-eurc-usdc",
    title: "Navigating MiCA: Why Furlpay Enforces Auto-Swaps to EURC/USDC",
    excerpt:
      "With MiCA in full effect from July 1 2026, Furlpay's Dynamic Compliance Engine auto-swaps non-compliant stablecoins into authorised EMTs for EEA users.",
    category: "compliance",
    date: "2026-06-25",
    readMins: 5,
    author: "Compliance Team",
    body: [
      { type: "h2", text: "The regulatory landscape" },
      {
        type: "p",
        text: `As of July 1, 2026, the European Union's Markets in Crypto-Assets (MiCA) regulation is in full effect. One of its strictest provisions governs Electronic Money Tokens (EMTs) — commonly known as fiat-pegged stablecoins. To be legal in Europe, stablecoin issuers must hold a licence as a European Electronic Money Institution (EMI) or credit institution, maintaining 100% reserve segregation and publishing monthly audits.`,
      },
      { type: "h2", text: "The USDT delisting wave" },
      {
        type: "p",
        text: `Because of these requirements, many offshore, unregulated stablecoins (such as USDT) face restrictions or delisting across the EEA. To keep Furlpay 100% compliant while protecting users from regulatory blocks, we built a Dynamic Compliance Engine directly into the wallet routing layer:`,
      },
      {
        type: "diagram",
        text: `[ Inbound USDT ] ──(EEA user?)──> Yes ──> [ Auto-swap via Li.Fi ] ──> [ Compliant EURC/USDC Wallet ]
                        └────────> No  ──> [ Standard USDT Deposit ]`,
      },
      {
        type: "p",
        text: `When a user in Europe receives a USDT payment or deposit, Furlpay detects the jurisdiction and automatically routes the transaction through on-chain liquidity (such as Uniswap or 1inch) to swap USDT for a fully authorised EMT — like EURC or Circle's USDC — before depositing it. European users can then spend seamlessly at Visa terminals without their cards being declined for regulatory reasons.`,
      },
    ],
  },

  // 4 -----------------------------------------------------------------
  {
    slug: "agentic-commerce-x402-ai-payments",
    title: "Agentic Commerce: Securing Autonomous AI Payments with x402",
    excerpt:
      "Furlpay now supports the x402 Machine Payments Protocol, letting users delegate spend-limited sub-wallets to autonomous AI agents.",
    category: "product-news",
    date: "2026-06-20",
    readMins: 5,
    author: "Furlpay Team",
    body: [
      { type: "h2", text: "The AI economy" },
      {
        type: "p",
        text: `We've entered the era of "agentic commerce." Users are no longer just using AI to write emails; they're deploying autonomous agents to manage businesses, buy software subscriptions and restock physical offices. But legacy card networks are structurally incapable of handling AI agents — they require human biometrics or 2FA checks to authorise a transaction.`,
      },
      { type: "h2", text: "Enter the x402 protocol" },
      {
        type: "p",
        text: `To bridge this gap, Furlpay is proud to support the x402 Machine Payments Protocol, developed in collaboration with Stripe and Coinbase:`,
      },
      {
        type: "code",
        lang: "typescript",
        code: `// Authorize an AI agent to execute payments under strict limits
const agentWallet = await Furlpay.agents.create({
  ownerAddress: userSafeAddress,
  spendingLimits: {
    daily: 100.00,        // maximum $100 per day
    perTransaction: 20.00 // maximum $20 per transaction
  },
  allowedMerchants: ["github.com", "openai.com", "vercel.com"]
});`,
      },
      {
        type: "p",
        text: `Using x402, users delegate a sub-wallet to an AI agent. The agent signs micro-transactions on L2 networks using programmatic keys, but only within the limits set in the wallet contract. If the agent is compromised or goes rogue, it cannot spend beyond its daily allowance — bringing security and accountability to the machine economy.`,
      },
    ],
  },

  // 5 -----------------------------------------------------------------
  {
    slug: "erc-4337-paymasters-l2",
    title: "Bypassing the Gas Crisis: ERC-4337 Paymasters on L2 Networks",
    excerpt:
      "Nobody should need ETH just to send USDC. How Furlpay uses ERC-4337 account abstraction and Paymasters to make gas disappear.",
    category: "engineering",
    date: "2026-06-15",
    readMins: 5,
    author: "Protocol Engineering",
    body: [
      { type: "h2", text: "The gas fee friction" },
      {
        type: "p",
        text: `One of the largest hurdles to mainstream blockchain adoption is gas fees. Forcing a user to buy and hold ETH or MATIC just to transfer USDC is a poor experience. If a user holds $50 of USDC, they should be able to send it immediately — without buying a gas token first.`,
      },
      { type: "h2", text: "Account abstraction & Paymasters" },
      {
        type: "p",
        text: `Furlpay leverages ERC-4337 account abstraction to solve this. Every Furlpay wallet is a deployed Safe smart-contract account. When a transaction is submitted:`,
      },
      {
        type: "ul",
        items: [
          `The transaction is packaged as a UserOperation.`,
          `It is sent to a Paymaster contract on-chain.`,
          `The Paymaster pays the network gas fee (in ETH) to the validator.`,
          `The Paymaster then deducts the equivalent value in USDC from the transaction — or sponsors the fee entirely for promotional tiers.`,
        ],
      },
      {
        type: "diagram",
        text: `[ User Action ] ──(USDC)──> [ Paymaster Contract ] ──(ETH gas paid)──> [ Blockchain Network ]`,
      },
      {
        type: "p",
        text: `This gas abstraction makes stablecoin transactions feel exactly like traditional Web2 payments — smooth, fast and free of blockchain jargon.`,
      },
    ],
  },

  // 6 -----------------------------------------------------------------
  {
    slug: "wise-mid-market-fx-rates",
    title: "Why Furlpay Integrates Wise for Mid-Market FX Rates",
    excerpt:
      "Most 'free' international transfers hide fees inside the exchange rate. Furlpay uses Wise's real mid-market rate with every fee shown upfront.",
    category: "product-news",
    date: "2026-06-10",
    readMins: 4,
    author: "Payments Team",
    body: [
      { type: "h2", text: "The FX fee scam" },
      {
        type: "p",
        text: `Many neobanks and payment platforms claim to offer "free" international transfers, but they hide their fees in the exchange rate. They apply a marked-up rate and pocket the difference — which can cost users up to 3% of their transfer value.`,
      },
      { type: "h2", text: "Total transparency via Wise" },
      {
        type: "p",
        text: `Furlpay is committed to total fee transparency. That's why we integrate directly with the Wise Business API for all fiat cross-border bank deposits (ACH, SEPA, SWIFT).`,
      },
      {
        type: "ul",
        items: [
          `Real mid-market rate: the exact rate you see on Google, with zero markups.`,
          `Upfront fees: conversion fees (typically 0.3% to 0.5%) are shown clearly before you confirm.`,
        ],
      },
      {
        type: "diagram",
        text: `[ User Stablecoins ] ──(Li.Fi swap)──> [ Fiat Account ] ──(Wise mid-market rate)──> [ Recipient Bank ]`,
      },
      {
        type: "p",
        text: `By combining stablecoin transfers with the Wise routing network, Furlpay lets you send money internationally at a fraction of the cost of traditional wires.`,
      },
    ],
  },

  // 7 -----------------------------------------------------------------
  {
    slug: "fractional-stock-investing-alpaca",
    title: "Fractional US Stock Investing on Web3 Rails: The Alpaca SDK",
    excerpt:
      "Buy $1 of AAPL, TSLA or SPY straight from your Web3 dashboard. Fractional US equities via the Alpaca Brokerage-as-a-Service API.",
    category: "product-news",
    date: "2026-06-05",
    readMins: 4,
    author: "Investing Team",
    body: [
      { type: "h2", text: "Unifying your assets" },
      {
        type: "p",
        text: `For most users, cash, stablecoins, crypto and stocks are scattered across different apps (Chase, Coinbase, Robinhood). This fragmentation makes it hard to track true net worth or move funds when markets shift. Furlpay solves it by bringing fractional stock investing directly into your Web3 dashboard.`,
      },
      { type: "h2", text: "Embedded brokerage-as-a-service" },
      {
        type: "p",
        text: `Furlpay integrates the Alpaca Brokerage-as-a-Service API to enable seamless equity trading:`,
      },
      {
        type: "ul",
        items: [
          `Fractional shares: buy as little as $1 of common stocks and ETFs (AAPL, TSLA, SPY).`,
          `Instant funding: sell stablecoins in your wallet and buy stocks immediately, without waiting for T+2 settlement.`,
        ],
      },
      {
        type: "code",
        lang: "typescript",
        code: `// Purchase fractional stock via Furlpay's investing client
const order = await furlpay.investing.placeOrder({
  symbol: 'AAPL',
  notional: 10.00, // buy exactly $10 of Apple stock
  side: 'buy',
  type: 'market'
});`,
      },
      {
        type: "p",
        text: `All accounts are opened directly with Alpaca Securities LLC, a regulated SEC broker-dealer, so your investments are protected by SIPC.`,
      },
    ],
  },

  // 8 -----------------------------------------------------------------
  {
    slug: "time-locked-preauthorization-escrows",
    title: "Solving Card Declines: Time-Locked Pre-Authorization Escrows",
    excerpt:
      "Why self-custodial cards get declined at gas pumps and hotels — and how Furlpay's time-locked escrow contracts fix pre-authorization holds.",
    category: "engineering",
    date: "2026-06-01",
    readMins: 5,
    author: "Protocol Engineering",
    body: [
      { type: "h2", text: "The card hold problem" },
      {
        type: "p",
        text: `Self-custodial debit cards frequently fail at gas pumps, hotels and car rental agencies. Traditional card networks require a pre-authorization hold (for example, locking $150 at the pump before fuel is dispensed). Because on-chain smart wallets can't easily support temporary hold states, these transactions are usually declined automatically.`,
      },
      { type: "h2", text: "The Furlpay escrow solution" },
      {
        type: "p",
        text: `To solve this, Furlpay developed the Pre-Authorization Escrow Contract. When a merchant requests a hold, our backend creates an isolated, time-locked escrow and moves the hold amount from the user's wallet into it.`,
      },
      {
        type: "diagram",
        text: `[ Merchant pre-auth ] ──> [ Time-locked Escrow ] ──(final amount)──> [ Merchant ]
                                 │
                                 └──(remainder / 7-day expiry)──> [ User Wallet ]`,
      },
      {
        type: "p",
        text: `Once the final purchase amount settles, the escrow releases that amount to the merchant and returns the remaining balance to the user. If the merchant never claims the funds, the escrow automatically expires after 7 days, returning the entire deposit to the user — no stuck holds, no manual reversals.`,
      },
    ],
  },

  // 9 -----------------------------------------------------------------
  {
    slug: "death-of-the-seed-phrase-webauthn",
    title: "The Death of the Seed Phrase: WebAuthn & Device Trust",
    excerpt:
      "Furlpay replaces the 12-word seed phrase with phishing-resistant WebAuthn passkeys bound to your device's secure hardware.",
    category: "engineering",
    date: "2026-05-28",
    readMins: 5,
    author: "Security Engineering",
    body: [
      { type: "h2", text: "The usability gap" },
      {
        type: "p",
        text: `For decades, using cryptocurrency required writing down a 12- or 24-word seed phrase. Cryptographically secure, yes — but a massive usability gap for average users. Lose the paper and your funds are gone forever. Get tricked into typing it on a malicious site and your wallet is instantly drained.`,
      },
      { type: "h2", text: "Phishing-resistant WebAuthn" },
      {
        type: "p",
        text: `Furlpay replaces seed phrases entirely by leveraging WebAuthn (FIDO2) credentials:`,
      },
      {
        type: "code",
        lang: "javascript",
        code: `// Register a new Furlpay account using local biometrics
const credential = await navigator.credentials.create({
  publicKey: {
    challenge: serverChallenge,
    rp: { name: "Furlpay" },
    user: { id: userId, name: userName, displayName: userName },
    pubKeyCredParams: [{ alg: -7, type: "public-key" }] // ES256
  }
});`,
      },
      {
        type: "p",
        text: `This API triggers the user's device — MacBook Touch ID, Windows Hello or a YubiKey — to generate a secure public-key credential. The private key stays locked inside the device's hardware security chip, protected from remote extraction and phishing. Furlpay associates the public key with your Safe smart wallet on-chain, letting you sign transactions with a fingerprint or face scan.`,
      },
    ],
  },

  // 10 ----------------------------------------------------------------
  {
    slug: "hybrid-off-chain-policy-guards",
    title: "Securing the Ledger: Hybrid Off-Chain Policy Guards vs. Modular Bugs",
    excerpt:
      "Modular smart wallets expand the attack surface. Furlpay's hybrid guard pairs on-chain Safe wallets with an off-chain HSM policy engine.",
    category: "security",
    date: "2026-05-24",
    readMins: 6,
    author: "Security Team",
    body: [
      { type: "h2", text: "The risk of pure on-chain modularity" },
      {
        type: "p",
        text: `Modern smart-contract wallets are designed to be modular. That flexibility lets developers add features like spending limits and time-locks — but it also expands the attack surface. If a single module contains a signature-verification flaw, an attacker can bypass the wallet's main security controls and drain its assets.`,
      },
      { type: "h2", text: "Furlpay's hybrid guard architecture" },
      {
        type: "p",
        text: `To protect user assets from contract exploits, Furlpay implements a Hybrid Guard System that combines on-chain smart wallets with an off-chain security engine:`,
      },
      {
        type: "diagram",
        text: `[ User Action ] ──> [ Policy Guard ] ──(verified?)──> Yes ──> [ HSM co-signs ] ──> [ Safe executes ]
                                     └──────────────────> No  ──> [ Blocked ]`,
      },
      {
        type: "p",
        text: `Every transaction requires a 2-of-2 signature:`,
      },
      {
        type: "ul",
        items: [
          `Signature 1: generated by the user's local passkey (client-side).`,
          `Signature 2: generated by Furlpay's HSM backend (server-side).`,
        ],
      },
      {
        type: "p",
        text: `Before the HSM co-signs, it runs real-time security checks:`,
      },
      {
        type: "ul",
        items: [
          `Velocity limits — does this transaction exceed the user's typical patterns?`,
          `Address screening — is the destination linked to high-risk wallets (via the Chainalysis API)?`,
          `Sanctions checks — does the transaction comply with global regulatory guidelines?`,
        ],
      },
      {
        type: "p",
        text: `If an attacker exploits a bug in a smart-contract module, they still can't drain your wallet — they lack the HSM's co-signature. This hybrid approach gives you the security of self-custody alongside the active protection of a traditional bank.`,
      },
    ],
  },

  // 11 ----------------------------------------------------------------
  {
    slug: "furlpay-for-openbb-execution-layer",
    title: "FurlPay for OpenBB: Giving the Open-Source Terminal an Execution Layer",
    excerpt:
      "OpenBB gives 50,000+ analysts and AI agents world-class financial data — but it can't move a dollar. Our new open-source plugin adds the missing half: screen an asset in OpenBB, then trade it, DCA into it, or settle agentic API revenue, all in stablecoins.",
    category: "product-news",
    date: "2026-07-04",
    readMins: 6,
    author: "Furlpay",
    featured: true,
    body: [
      {
        type: "p",
        text: `Every serious financial-data platform in 2026 has converged on the same shape: rich data plus a Model Context Protocol (MCP) server so AI agents can query it. OpenBB shipped Workspace MCP. Morningstar's MCP server is live inside Claude, ChatGPT, and Copilot. Bloomberg is under pressure from a wave of $200-a-month AI alternatives. But every one of them stops at the same wall — they can research an asset, and they cannot act on it. The agent can tell you a fund is a five-star buy; it cannot buy it.`,
      },
      {
        type: "p",
        text: `That gap is exactly the shape of FurlPay. Today we're releasing furlpay-openbb-plugin — an open-source backend that drops FurlPay's execution layer directly into the OpenBB Workspace canvas an analyst already lives in.`,
      },
      { type: "h2", text: "Research → Execute, in one workspace" },
      {
        type: "p",
        text: `The plugin registers as a standard OpenBB custom backend: it serves the widgets.json and apps.json that OpenBB expects, and ships a ready-made "Research to Execution" app with four tabs. It exposes two kinds of widgets — the data OpenBB users expect, and the execution OpenBB itself doesn't have.`,
      },
      {
        type: "ul",
        items: [
          `Data widgets — portfolio summary, open positions with live P&L, stablecoin balances across Solana and Base, x402 paywall revenue, and recent payments.`,
          `Action widgets — Place Order (buy or sell a fractional position, funded in USDC), Auto-Invest (schedule a recurring DCA), and Send Stablecoins. Each is an OpenBB input form that posts to the FurlPay API and refreshes a blotter with the result.`,
        ],
      },
      {
        type: "diagram",
        text: `[ Screen an asset in OpenBB ] ──> [ Place Order / DCA form ] ──> [ FurlPay API ]
                                                                        │
                                          fractional · USDC-funded · 24/7 · on-chain settle`,
      },
      { type: "h2", text: "Why stablecoins make this work" },
      {
        type: "p",
        text: `Because execution is fractional and stablecoin-funded, a $1 order works exactly like a $10,000 one — no bank rails, no market-hours gate, no minimums. An analyst in any country can screen the S&P 500 in OpenBB and dollar-cost-average into it with USDC from the same screen. The same rails settle agentic revenue: the x402 paywall widget shows per-resource calls and USDC earned, so an API that charges AI agents per call reconciles in the same dashboard where its owner trades.`,
      },
      { type: "h2", text: "Open source, clone-and-run" },
      {
        type: "p",
        text: `The plugin is MIT-licensed and runs on deterministic demo data out of the box — add http://localhost:7777 as a custom backend and every widget renders immediately, no account required. Set a FurlPay API key and the same widgets go live against your real portfolio, wallets, and paywalls. A 12-test suite asserts the exact OpenBB contract so a green run means it will register and render.`,
      },
      {
        type: "quote",
        text: `Bloomberg has the data. Morningstar has the research. OpenBB has the terminal. None of them move money. That's the layer we build — and now it lives inside the terminal too.`,
      },
      {
        type: "p",
        text: `Get it at github.com/FurlPay/furlpay-openbb-plugin. It's the first of a series of composed integrations — pairing the open-source financial data stack with the one thing it's always been missing: rails that actually execute.`,
      },
    ],
  },

  // 12 ----------------------------------------------------------------
  {
    slug: "x402-guard-closing-all-five-free-riding-attacks",
    title: "x402-guard v0.2: Closing All Five Free-Riding Attacks on Agentic Payments",
    excerpt:
      "A 2026 security paper catalogues five ways to free-ride an x402 facilitator, reaching resource-leakage ratios up to 100%. x402-guard now ships a tested defense for every one — as a zero-dependency library any facilitator can drop in.",
    category: "security",
    date: "2026-07-03",
    readMins: 7,
    author: "Furlpay Security",
    body: [
      {
        type: "p",
        text: `x402 decouples off-chain verification from on-chain settlement to get throughput. That gap is where the money leaks. "Free-Riding the Agentic Web: A Systematic Security Analysis of x402 Payments" (arXiv:2605.30998) tested official SDKs and a production deployment and found resource-leakage ratios up to 100% — attackers receiving the paid resource while paying little or nothing. It catalogues five distinct flaw classes. Most facilitators in the wild defend none of them.`,
      },
      {
        type: "p",
        text: `x402-guard is our answer: a zero-dependency TypeScript library that hardens the state machine around any x402 settler, independent of which facilitator or SDK you run. Version 0.2 closes all five classes, each with a test that reproduces the attack and proves it's blocked.`,
      },
      { type: "h2", text: "The five flaws — and the fix for each" },
      {
        type: "ul",
        items: [
          `F1 Cross-resource substitution — a payment minted for resource A unlocks an equal-priced resource B. Fix: commit H(method · uri · body) into the authorization and reject any mismatch. Near-universal in the wild: 38% of hosts expose same-price sibling resources.`,
          `F2 Duplicate-settlement race — concurrent requests with one nonce all clear verification before any settles on-chain; each gets the service, one pays. Fix: atomic nonce linearization (Null → PENDING → SETTLED), and — critically — never roll a timed-out nonce back to replayable.`,
          `F3 Allowance overdraft — under the "upto" scheme, N concurrent requests each read the full remaining balance and all proceed, spending N times the authorized amount. Fix: pessimistic reserve-commit — escrow the max atomically before execution, bill the actual, refund the rest.`,
          `F4 Denial of settlement — an attacker floods the facilitator with slow settlements until honest ones time out, and the server that already delivered eats the loss. Fix: reserve settlement capacity before serving; overflow returns 429 instead of free service.`,
          `F5 Hidden-compute pricing — pay-per-token cost is unknowable at quote time, so adversarial prompts maximize compute per fixed quote. Fix: an adaptive billing weight that learns the observed cost ratio and quotes enough headroom that the escrow always covers the bill — honest callers are refunded the difference.`,
        ],
      },
      { type: "h2", text: "Why a library, and why failure-closed" },
      {
        type: "p",
        text: `The subtle bug is the timeout. A naive facilitator deletes the nonce when settlement "fails" — but a facilitator timeout is not proof the transaction failed; it may still confirm on-chain. Freeing the nonce reopens it for replay. x402-guard distinguishes a settlement that provably did not land (safe to release) from one whose outcome is unknown (kept locked, never replayable). Every defense fails closed: when in doubt, refuse — never serve for free.`,
      },
      {
        type: "diagram",
        text: `[ settle request ] ──> reserve capacity (F4) ──> bind-check (F1) ──> atomic nonce claim (F2)
                                                                              │
                          confirmed ──> SETTLED    failed_no_tx ──> released    unknown ──> stays LOCKED`,
      },
      {
        type: "p",
        text: `The nonce and allowance stores are simple interfaces — the in-memory defaults are atomic within one process, and map directly onto Redis SETNX or a conditional SQL decrement for multi-instance facilitators. No dependencies, works on Base, Solana, or any x402 deployment.`,
      },
      {
        type: "quote",
        text: `Agentic commerce only works if machine payments are safe for the seller. Every one of these attacks steals from the API provider — quietly, at machine speed, thousands of times a minute.`,
      },
      {
        type: "p",
        text: `x402-guard is MIT-licensed and open source at github.com/FurlPay/x402-guard. The test suite reproduces each attack — including the paper's 20-concurrent-request race — and asserts it's defeated. As the x402 Foundation drives toward a v1.0 spec, these are the semantics we think belong in the standard.`,
      },
    ],
  },

  // 13 ----------------------------------------------------------------
  {
    slug: "letting-your-ai-agent-book-travel-travala-mcp-furlpay",
    cover: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1600&q=70",
    title: "Letting Your AI Agent Book Travel: Composing Travala's Travel MCP with FurlPay Payments",
    excerpt:
      "Travala launched its Agentic AI Travel Protocol on Base, enabling gasless USDC travel bookings. Here is how to compose their Travel MCP with FurlPay's wallets and x402 budget guards using TypeScript.",
    category: "travel",
    date: "2026-07-04",
    readMins: 5,
    author: "FurlPay Engineering",
    body: [
      {
        type: "p",
        text: `In June 2026, Travala launched its Agentic AI Travel Protocol, introducing a remote Model Context Protocol (MCP) server accessible at https://travel-mcp.travala.com/mcp. This allows autonomous AI agents to search and reserve from over 2.2 million properties globally. However, search and selection are only half the battle. To complete the loop, the agent needs a secure payment mechanism that respects spending limits and doesn't require sharing raw API keys or card numbers.`,
      },
      {
        type: "p",
        text: `By composing Travala's Travel MCP with FurlPay's payment rails, developers can build agents that book travel autonomously. FurlPay acts as the payment and financial orchestration layer, allowing agents to request single-use payment authorizations using the x402 open standard on Base and Solana.`,
      },
      { type: "h2", text: "The Agentic Travel Flow" },
      {
        type: "diagram",
        text: `[ AI Agent ] ──> Searches inventory via Travala Travel MCP (travel-mcp.travala.com/mcp)
     │
     ├──> Requests budget clearance from FurlPay wallet (ERC-7715 session keys)
     │
     └──> Signs & settles gasless USDC transaction via x402 on Base L2`,
      },
      { type: "h2", text: "Composing the MCP Tools" },
      {
        type: "p",
        text: `Using FurlPay's client SDK, developers can implement an agent tool that handles the budget authorization and payment settlement. This allows the AI agent to verify that the booking quote matches the user's spending policies before executing the transaction.`,
      },
      {
        type: "code",
        lang: "typescript",
        code: `import { FurlPayClient } from "@furlpay/furlpay-node";

// Verify booking quote and generate on-chain x402 payment proof
const client = new FurlPayClient({ apiKey: process.env.FURLPAY_SECRET_KEY });

const quote = await client.travel.verifyQuote({
  quoteId: "trvl_quote_9821379",
  amount: 180.00,
  currency: "USDC"
});

if (quote.isValid && quote.amount <= maxBudgetLimit) {
  const paymentProof = await client.x402.createProof({
    amount: quote.amount,
    token: "USDC",
    destination: "travala_facilitator"
  });
  console.log("Booking authorized. Transaction hash:", paymentProof.txHash);
}`,
      },
      {
        type: "quote",
        text: `In the agentic web, search is performed by the machine, but authorization must remain anchored to the human. Composing the inventory provider with the payment gateway is the ultimate friction reducer for travel.`,
      },
      {
        type: "p",
        text: `Furthermore, developers who integrate these tools can capture Travala's 10% cbBTC (Coinbase Wrapped Bitcoin) rebate. FurlPay automatically routes these rebates back to the developer's wallet, creating a sustainable monetization channel for autonomous agents.`,
      },
    ],
  },

  // 14 ----------------------------------------------------------------
  {
    slug: "tradfi-goes-24-7-mastercard-stablecoin-settlement",
    cover: "https://images.unsplash.com/photo-1449034446853-66c86144b0ad?auto=format&fit=crop&w=1600&q=70",
    title: "TradFi Goes 24/7/365: Leveraging Mastercard's New Stablecoin Rails for Corporate Travel",
    excerpt:
      "Mastercard acquired BVNK for $1.8B and announced 24/7 intraday stablecoin settlement. Here is how FurlPay B2B Travels leverages these rails to issue programmatically locked virtual corporate debit cards.",
    category: "travel",
    date: "2026-07-04",
    readMins: 5,
    author: "FurlPay Product",
    body: [
      {
        type: "p",
        text: `Traditional corporate travel booking is choked by legacy banking calendars. Weekend flight updates, last-minute room adjustments, or holiday travel bookings frequently fail because of settlement delays, leading to canceled reservations and accounting friction. With Mastercard's acquisition of BVNK and their expansion of settlement capabilities to support intraday, weekend, and holiday settlement for regulated stablecoins (USDC), the financial rails are finally matching the speed of travel.`,
      },
      {
        type: "p",
        text: `FurlPay B2B Travels integrates directly with these new 24/7 settlement rails, allowing companies to fund corporate travel accounts with stablecoins and instantly issue virtual travel cards to employees.`,
      },
      { type: "h2", text: "24/7 Stablecoin Settlement" },
      {
        type: "diagram",
        text: `[ Corporate USDC Treasury ] ──(24/7/365 Intraday Rail)──> [ FurlPay Card Engine ]
                                                             │
                                                  (Single-Use Virtual Card)
                                                             │
                                                             ▼
                                                [ Visa/Mastercard Network ]`,
      },
      { type: "h2", text: "Dynamic Spending Controls & MCC Locks" },
      {
        type: "p",
        text: `When an employee requests travel authorization, FurlPay programmatically issues a single-use virtual card. By leveraging Mastercard's real-time settlement and our card issuing engine, we apply strict Merchant Category Code (MCC) locks. This guarantees the card can only be charged by travel merchants (e.g., lodging and airlines) and is capped at the exact amount of the booking, eliminating expense fraud by design.`,
      },
      {
        type: "quote",
        text: `TradFi is going 24/7. FurlPay's double-entry ledger and card issuing platform allow startups to instantly tap into this real-time payment network, using stablecoins to fund employee travel globally.`,
      },
    ],
  },

  // 15 ----------------------------------------------------------------
  {
    slug: "inside-the-visa-and-bridge-stablecoin-cards-rollout",
    cover: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1600&q=70",
    title: "Stablecoin Cards in 100+ Countries: Inside the Visa and Bridge Global Rollout",
    excerpt:
      "Visa and Stripe-owned Bridge have expanded their partnership to scale stablecoin-linked card issuing in over 100 countries. We explore how FurlPay utilizes this global network to enable instant fiat conversions at the checkout.",
    category: "travel",
    date: "2026-07-04",
    readMins: 6,
    author: "FurlPay Compliance",
    body: [
      {
        type: "p",
        text: `Visa and Stripe-owned Bridge have expanded their partnership to bring stablecoin-linked card issuance to over 100 countries. This is a massive milestone for global travel, as it allows stablecoins (like USDC and USDT) to be spent seamlessly at millions of physical and digital merchants worldwide, with instant fiat conversion at the point of sale.`,
      },
      {
        type: "p",
        text: `FurlPay Travels leverages this global network to bridge Web3 wallets with legacy travel merchants (such as Airbnb, Booking.com, and local train networks) that do not yet accept crypto natively.`,
      },
      { type: "h2", text: "Real-Time Crypto-to-Fiat Conversion" },
      {
        type: "p",
        text: `When a traveler checks out on FurlPay, the platform uses Bridge's API in the background to swap the traveler's stablecoins into the merchant's local currency (USD, EUR, or GBP) in real-time. The merchant receives a standard bank settlement, while the traveler avoids the friction of manual off-ramping or holding multiple fiat currencies.`,
      },
      { type: "h2", text: "Global Compliance and the Travel Rule" },
      {
        type: "p",
        text: `Operating a cross-border travel network in 2026 requires strict adherence to international regulations, including the Financial Action Task Force (FATF) Travel Rule and the European Union's Markets in Crypto-Assets (MiCA) regulation. FurlPay's Dynamic Compliance Engine monitors every transaction:`,
      },
      {
        type: "ul",
        items: [
          `Auto-swapping non-compliant stablecoins into licensed EMTs (Electronic Money Tokens like EURC) for EEA users.`,
          `Verifying originator and beneficiary identity for transactions exceeding $1,000.`,
          `Performing real-time sanctions screening before cards are issued.`,
        ],
      },
      {
        type: "quote",
        text: `Compliance isn't a blocker; it's the bridge that allows on-chain finance to scale to the physical world. By embedding Travel Rule verification directly into the checkout, we keep global travel safe and legal.`,
      },
    ],
  },
  // Open USD ----------------------------------------------------------
  {
    slug: "why-furlpay-is-adopting-open-usd",
    cover: "https://images.unsplash.com/photo-1621761191319-c6fb62004040?auto=format&fit=crop&w=1600&q=70",
    title: "Why Furlpay Is Adopting Open USD — the Visa, Mastercard & Coinbase Stablecoin Standard",
    excerpt:
      "In July 2026, a 140-firm consortium — Visa, Mastercard, Stripe, Coinbase, BlackRock, BNY, Google and Ripple among them — launched Open USD (OUSD), a partner-governed stablecoin that shares reserve revenue and undercuts the single-issuer model. Here's why Furlpay is adding it as a settlement rail for travel and brokerage.",
    category: "travel",
    date: "2026-07-04",
    readMins: 6,
    author: "Furlpay",
    featured: true,
    body: [
      {
        type: "p",
        text: `On July 3, 2026, a new independent company called Open Standard launched Open USD (OUSD) — a fully-reserved US-dollar stablecoin backed by a consortium of more than 140 firms spanning banking, payments, tech and crypto: Visa, Mastercard, Stripe, Coinbase, BlackRock, BNY, Google, IBM, Ripple, OKX and Standard Chartered among them. The market reaction was immediate — Circle's stock fell roughly 13% within hours as traders priced OUSD as a direct competitor to USDC and USDT. This is the most significant stablecoin launch since USDC itself, and Furlpay is adopting it.`,
      },
      { type: "h2", text: "Why the industry wanted a neutral stablecoin" },
      {
        type: "p",
        text: `Today's dominant stablecoins are single-issuer: one company mints the token, holds the reserves, and keeps the interest those reserves earn. That concentrates both counterparty risk and economics. OUSD is structured to break that model. It's operated by Open Standard — an independent company whose board is composed of the consortium's partners, with founding CEO Zach Abrams — so no single firm controls issuance. Businesses can mint and redeem OUSD at no cost and with no volume caps, and nearly all of the interest earned on the backing reserves flows to partners after a management fee, rather than to one issuer.`,
      },
      { type: "h2", text: "What's actually different about OUSD" },
      {
        type: "ul",
        items: [
          `Partner-governed, not single-issuer — reserve risk and revenue are distributed across the consortium, not held by one company.`,
          `Free mint & redeem, no caps — treasuries can move in and out of OUSD without spread or volume limits, which matters for high-throughput settlement.`,
          `Shared reserve revenue — the interest on reserves is returned to partners, changing the economics of every business that routes volume through it.`,
          `Multi-chain from launch — OUSD goes live natively on Solana from day one, with Stellar, Base, Polygon and other chains following through 2026.`,
        ],
      },
      { type: "h2", text: "How Furlpay uses OUSD" },
      {
        type: "p",
        text: `Furlpay is a settlement-agnostic financial OS: the same API moves stablecoins for payments, fractional investing, and agentic x402 calls. Adding OUSD alongside USDC gives our users a neutral, institutional-grade dollar for two flows in particular — travel and brokerage.`,
      },
      {
        type: "ul",
        items: [
          `Travel — Furlpay Travels settles bookings routed through Travala's Agentic AI Travel Protocol in gasless stablecoin on Base and Solana. OUSD's zero-cost mint/redeem and native Solana support make it a natural funding token for both agent-initiated x402 bookings and single-use Visa virtual cards.`,
          `Brokerage — fractional stock and ETF orders (via Alpaca) are funded from the same wallet. Settling in a consortium-backed dollar reduces the conversion friction between on-chain balances and regulated brokerage rails.`,
          `Micro-transactions — high-throughput, low-fee settlement on Solana and Base makes sub-cent flows economically viable: pay-per-call API data over x402, per-booking travel insurance, and agent tips.`,
        ],
      },
      {
        type: "diagram",
        text: `[ Furlpay wallet: USDC · OUSD ]
        │
        ├─ x402 / Travala booking ─▶ gasless settle on Base/Solana ─▶ 10% cbBTC rebate
        ├─ single-use Visa VCN ────▶ Visa × Bridge rails ───────────▶ 100+ countries
        └─ Alpaca fractional order ▶ regulated brokerage settlement`,
      },
      {
        type: "p",
        text: `Because Furlpay never hard-codes a single settlement token, adopting OUSD is additive: existing USDC integrations keep working, and users gain a second dollar backed by the networks that already run global commerce. We'll roll OUSD support out first on Solana — where it launches natively — then Base, tracking Open Standard's own chain schedule.`,
      },
      {
        type: "quote",
        text: `The winning stablecoin for real-world commerce won't be the one with the best yield — it'll be the one payments networks, banks and merchants already trust. OUSD is that bet, and Furlpay is built to route it.`,
      },
    ],
  },
  // ------------------------------------------------------------------
  {
    slug: "travel-super-app-race-2026-payments-decide",
    title: "The 2026 Travel Super-App Race Will Be Decided at the Payment Step",
    excerpt:
      "Online travel is a $719B market racing toward $1.3T, and Booking, Airbnb and Trip.com are all rebuilding as super-apps. But the layer none of them own — money movement — is where the race gets decided.",
    category: "travel",
    date: "2026-07-05",
    readMins: 9,
    author: "FurlPay Travels",
    body: [
      {
        type: "p",
        text: `Online travel booking is projected to grow from roughly $719 billion in 2026 to over $1.3 trillion by 2033 — a 9% compound annual clip — and the way people book has already tipped: mobile drives more than 63% of global online bookings and 68% of travel searches. The strategic response from the big three platforms is identical in ambition and different in execution: stop being a booking site, become the operating system for the whole trip.`,
      },
      { type: "h2", text: "Three super-app strategies" },
      {
        type: "ul",
        items: [
          `Trip.com is the transactional consolidator — flights across ~5,000 cities, 1.4M hotels, direct rail APIs (Eurostar, National Rail) with a "Split Tickets" engine that segments journeys to find cheaper fares, and a flight-hotel cancellation guarantee stitching verticals together.`,
          `Airbnb's Summer 2026 release pivots from home-sharing to full-service travel: boutique hotels in 20 gateway cities, plus Instacart groceries, Welcome Pickups airport transfers, and Bounce luggage storage embedded directly in the post-booking flow.`,
          `Booking.com layers GPT-4o-mini "Smart Filters" over the industry's deepest structured inventory — you describe the hotel in a sentence, the LLM applies the filter boxes for you.`,
        ],
      },
      { type: "h2", text: "The cracks are all money-shaped" },
      {
        type: "p",
        text: `Look at where travelers actually get angry with these platforms in 2026 and a pattern emerges. Booking.com's Best Rate Guarantee pays out in Booking Wallet credit — after claims survive single-screenshot rules and currency-conversion nitpicks — and cashing out takes a support call. Airbnb's boutique-hotel price match refunds exclusively in travel credit, capped at $400, expiring in twelve months. Genius loyalty discounts are routinely funded by inflated base rates, so logged-in members sometimes pay more than an incognito window. None of these are search problems or inventory problems. They are all payment problems: platforms treating refunds and rewards as retention leverage instead of money.`,
      },
      { type: "h2", text: "Agentic booking makes payments the whole ballgame" },
      {
        type: "p",
        text: `The next booking interface is conversational. Sabre, PayPal and MindTrip are assembling an end-to-end agentic pipeline — conversational planning over 420+ airlines and 2M hotels with payment inside the chat. Google has said plainly it has no intention of becoming an OTA; it wants to hand qualified intent to whoever can complete the transaction. And in the most telling move of the year, OpenAI pulled native travel checkout from ChatGPT after finding users happily plan in chat but balk at typing card numbers into it. Planning is solved. Trust at the moment money moves is not.`,
      },
      { type: "h2", text: "Walking the 2026 booking funnel, stage by stage" },
      {
        type: "p",
        text: `Trace a 2026 trip from first daydream to final refund and you can see exactly where trust holds and where it breaks. Inspiration is a solved stage: TikTok, Instagram and AI-curated feeds surface destinations more effectively than any brochure ever did, and travelers arrive at platforms already knowing roughly what they want. Planning is solved too — conversational AI over inventories like Sabre's 420+ airlines and 2M hotels turns a week of tab-juggling into a ten-minute chat, and tools like Booking.com's Smart Filters translate a sentence into structured search. Selection follows the same arc: with deep inventory, verified reviews and LLM-ranked results, picking the right hotel or flight is no longer where users struggle or platforms differentiate.`,
      },
      {
        type: "p",
        text: `Then comes payment, and the funnel snaps. This is the trust gap: users who happily planned an entire itinerary in a chat interface refuse to type a card number into that same chat — the exact behavior that made OpenAI pull native travel checkout from ChatGPT. There is no cryptographic authorization standard the average traveler trusts an agent with, so the most automated funnel in history still ends with a human hesitating over a card form. Every stage upstream has been optimized; the moment money actually moves is the one moment platforms haven't earned.`,
      },
      {
        type: "p",
        text: `The two stages after payment are where the earlier cracks compound. In-trip is only partially solved — this is the super-app battleground, where Airbnb bolts on groceries and airport transfers, Trip.com stitches rail and cancellation guarantees, and everyone races to own the traveler mid-journey; useful, but fragmented and still maturing. Refunds, the final stage, is where trust breaks outright: this is credit-trap territory, where price-match payouts arrive as expiring wallet credit, guarantees are capped and hedged with screenshot rules, and getting actual cash back requires a support call. A funnel that starts with frictionless AI inspiration ends with your own money held hostage as a retention token — and that asymmetry, not inventory or search, is the real weakness of the 2026 booking stack.`,
      },
      { type: "h2", text: "Our bet: settle like software" },
      {
        type: "p",
        text: `FurlPay Travels is built on the premise that the payment layer — not inventory breadth — is the durable differentiator. Agents pay over x402 with cryptographic authorization instead of a card number in a chat box. Refunds and price-match payouts settle as USDC cash to your wallet in under a minute — never as credit that expires. And this week we shipped two features straight from this thesis: Price Alerts with an honest success-rate model and auto-book from your USDC balance when your target lands, and a Price Match Guarantee that pays the difference in withdrawable USDC, not a coupon.`,
      },
      {
        type: "quote",
        text: `Super-apps compete on how much of the trip they capture. We compete on what every leg of the trip runs on: money that moves at machine speed and stays yours.`,
      },
    ],
  },
  // ------------------------------------------------------------------
  {
    slug: "polite-sanitization-ai-review-summaries",
    title: "Polite Sanitization: When AI Review Summaries Hide the Warnings That Matter",
    excerpt:
      "2026 investigations caught AI review summaries describing a food-poisoning-lawsuit resort as 'spotless' and systemic harassment as 'minor service lapses.' Here's why models flatten danger — and how verified, settlement-bound reviews fix it.",
    category: "travel",
    date: "2026-07-04",
    readMins: 6,
    author: "FurlPay Travels",
    body: [
      {
        type: "p",
        text: `Reviews are the currency of online travel, and in 2026 that currency is being debased from two directions at once. On the supply side, industry studies estimate 15–20% of visible online reviews are now AI-generated fakes. On the interpretation side, the AI summaries platforms bolt on top have developed a failure mode consumer researchers call "polite sanitization" — and it is worse than fake reviews, because it launders real ones.`,
      },
      { type: "h2", text: "What the investigations found" },
      {
        type: "ul",
        items: [
          `A consumer-group audit found an AI summary describing a Cape Verde resort as "spotless" with "rave reviews for diverse dining" — omitting that the property faced high-court litigation from hundreds of guests over mass food poisoning and documented rodent activity.`,
          `Another summary called hotel staff "friendly" while the underlying reviews contained repeated reports from female guests of systemic harassment, compressed by the model into "minor service lapses."`,
        ],
      },
      {
        type: "p",
        text: `The mechanism is boring and structural. Generative models are trained mostly on neutral-to-positive consumer language, and summarization optimizes for the statistical center of a corpus. Fear, disgust and physical danger are edge cases by definition — so the model averages them away. A hundred five-star reviews and three reports of rats in the kitchen summarize to "guests love the food." No one lied; the truth just got smoothed.`,
      },
      { type: "h2", text: "The industry's answer: verify harder" },
      {
        type: "p",
        text: `Booking.com's May 2026 update shows where platforms are heading: reviews only count within 28 days of a verified checkout, scores roll over a 24-month window with a recency boost, and the first month of enforcement purged 7,800 unverifiable reviews. Verification is the right instinct — but it only fixes the supply side. A perfectly verified corpus still gets sanitized by the summary layer on top.`,
      },
      { type: "h2", text: "How FurlPay Travels handles it" },
      {
        type: "ul",
        items: [
          `Settlement-bound reviews: a review can only be attached to a booking that settled on-chain. The payment receipt is the proof of stay — there is no review form without a matching settlement, so synthetic review farms have nothing to attach to.`,
          `Safety flags are never averaged: reports tagged hygiene, safety or harassment bypass summarization entirely and surface verbatim, with counts — "3 guests reported pest activity in the last 90 days" — even when the overall score is 4.8.`,
          `Summaries state coverage, not vibes: every AI digest on a property page discloses how many verified stays it draws from and links the raw reviews it compressed.`,
        ],
      },
      {
        type: "quote",
        text: `An AI summary that reads well and hides a health hazard isn't a summary — it's a liability with good manners. The fix is structural: bind reviews to settled payments, and never let safety signals pass through an averaging function.`,
      },
      {
        type: "p",
        text: `Trust infrastructure is payments infrastructure. The same on-chain receipt that makes our refunds instant makes our reviews attributable — one primitive, two problems solved.`,
      },
    ],
  },
  // 23 ----------------------------------------------------------------
  {
    slug: "crypto-vs-card-fees-the-real-math",
    title: "Crypto vs Card Fees: The Real Math on Every $100,000 in Sales",
    excerpt:
      "Credit cards take 2.9%-3.5% of every sale. USDC on Arbitrum takes 0.5%. On $100,000 in volume that is roughly a $3,000 difference. Here is the honest, line-by-line math — including the costs each side hides.",
    category: "product-news",
    date: "2026-07-06",
    readMins: 7,
    author: "Furlpay Team",
    featured: true,
    cover: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `Payment fees are the tax nobody quotes you at signup. They sit at 2.9% plus 30 cents on most card transactions, and by the end of the year they are one of the largest line items a small business never negotiated. Stablecoin payments change that number by an order of magnitude. This is the real math — not a marketing figure — with the parts each rail would rather you not add up.`,
      },
      { type: "h2", text: "How much do card payments actually cost?" },
      {
        type: "p",
        text: `A US card payment costs a merchant roughly 2.9% + $0.30 online (the standard published rate at processors like Stripe), and a blended 3.5% is a fair estimate once you include international cards, premium rewards cards, and chargeback fees. That fee is really three stacked fees: interchange paid to the card-issuing bank, network assessments paid to Visa or Mastercard, and the processor's own margin.`,
      },
      {
        type: "table",
        headers: ["On $100,000 in sales", "Card (2.9% + 30¢)", "Card (3.5% blended)", "Furlpay (USDC, 0.5%)"],
        rows: [
          ["Percentage fee", "$2,900", "$3,500", "$500"],
          ["Per-transaction fee*", "~$400", "included", "~$5 gas"],
          ["Chargeback exposure", "Yes", "Yes", "None"],
          ["Total cost", "~$3,300", "~$3,500", "~$505"],
        ],
        highlightCol: 3,
      },
      {
        type: "p",
        text: `*Assumes an average ticket around $75, so $100,000 is roughly 1,330 transactions at $0.30 each. The exact number moves with your average order value — a store selling $15 items pays far more in fixed per-transaction fees than one selling $500 items.`,
      },
      { type: "h2", text: "What does a USDC payment on Arbitrum cost?" },
      {
        type: "p",
        text: `A USDC payment on Furlpay costs a flat 0.5% plus Arbitrum gas, which runs between a tenth of a cent and half a cent per transaction. There is no interchange because there is no card-issuing bank, no network assessment because there is no card network, and no chargeback reserve because on-chain payments are final. You can verify a live quote right now at [furlpay.com/api/payments/fees/estimate](https://furlpay.com/api/payments/fees/estimate?amount=150).`,
      },
      {
        type: "diagram",
        text: `$100,000 in card sales  →  you keep ~$96,700\n$100,000 in USDC sales  →  you keep ~$99,495\n                              ─────────────────\n                              ~$2,795 more, per $100k`,
      },
      { type: "h2", text: "The costs each side hides" },
      {
        type: "p",
        text: `Honest comparisons have to include the awkward parts. Cards hide the cost of chargebacks and multi-day settlement holds: a disputed transaction can cost you the sale plus a $15-$25 dispute fee, and a rolling reserve ties up cash you have already earned. Stablecoins hide a different cost: your customer needs USDC and a wallet. Furlpay narrows that gap with passkey wallets that need no seed phrase and a checkout that guides funding, but card acceptance is still more universal today. The right framing is not "crypto replaces cards everywhere" — it is "offer USDC as the cheaper option and keep the 0.5% instead of the 3%."`,
      },
      {
        type: "ul",
        items: [
          `Card costs that do not show on the sticker: chargeback fees, rolling reserves, cross-border surcharges, and PCI compliance overhead.`,
          `Stablecoin costs that do not show on the sticker: customer wallet friction and the operational work of holding or converting USDC — both shrinking as passkey wallets mature.`,
          `Where the math is decisive: high volume, low margin, cross-border, and recurring or machine-to-machine payments.`,
        ],
      },
      { type: "h2", text: "When cards still win" },
      {
        type: "p",
        text: `If most of your customers will only ever tap a card, a 0.5% rail they do not use saves nothing. Cards win on ubiquity, on familiar dispute rights, and on the long tail of local payment methods that processors like Stripe support. That is why most businesses adding stablecoin acceptance run it alongside cards rather than instead of them — see our full breakdown in [Furlpay vs Stripe](/compare/stripe).`,
      },
      { type: "h2", text: "Run your own number" },
      {
        type: "p",
        text: `The figures above scale linearly, so the savings on your volume are easy to estimate: multiply your annual card volume by roughly 3% to see what you would keep at 0.5%. Or use the interactive [fee savings calculator](/resources/tools/fee-calculator) to plug in your volume and average ticket, and read our [payments product page](/products/payments) for how settlement works end to end.`,
      },
      {
        type: "quote",
        text: `The card fee is not a law of nature. It is the price of a specific set of intermediaries. Remove the intermediaries and 3% becomes 0.5% — the same dollars, minus the toll.`,
      },
      {
        type: "p",
        text: `Furlpay is not a bank. Card figures are typical published rates and vary by issuer, card type, merchant category, and geography; the Furlpay figure is live and verifiable but excludes any conversion you choose to do between USDC and local currency. This article is informational, not financial advice.`,
      },
    ],
  },
  // 24 ----------------------------------------------------------------
  {
    slug: "usdc-vs-usdt-for-payments",
    title: "USDC vs USDT for Payments: Which Stablecoin Should a Business Accept?",
    excerpt:
      "USDT is bigger; USDC is more transparent. For accepting payments, reserve quality, attestations, and regulatory posture matter more than market cap. Here is how the two compare where it counts for merchants.",
    category: "compliance",
    date: "2026-07-06",
    readMins: 6,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1621761191319-c6fb62004040?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `USDT (Tether) and USDC (Circle) are both dollar-pegged stablecoins, and both let a business get paid in something that holds its value between the sale and the settlement. But they are not interchangeable when you are the one accepting them. The differences that matter for a merchant are reserve quality, attestation cadence, regulatory posture, and which chains they are cheap to move on — not which has the larger market cap.`,
      },
      { type: "h2", text: "The short answer" },
      {
        type: "p",
        text: `For accepting payments in the US and EU, USDC is generally the safer default: it publishes monthly third-party attestations, holds reserves in cash and short-dated US Treasuries, and is issued by a US-regulated company that has leaned into compliance frameworks like MiCA. USDT has the deepest liquidity and widest exchange support globally, which matters if your counterparties are international, but its reserve disclosures are less granular. Furlpay settles in USDC on Arbitrum for exactly these reasons.`,
      },
      {
        type: "table",
        headers: ["Factor", "USDC (Circle)", "USDT (Tether)"],
        rows: [
          ["Issuer", "Circle (US-regulated)", "Tether (offshore)"],
          ["Reserves", "Cash + short-dated US Treasuries", "Mixed; less granular disclosure"],
          ["Attestations", "Monthly, third-party", "Quarterly, less detailed"],
          ["Regulatory posture", "Proactive (MiCA, US frameworks)", "Broad global usage, lighter disclosure"],
          ["Liquidity", "Deep, growing", "Deepest globally"],
          ["Best for", "US/EU merchants, compliance", "International reach, exchanges"],
        ],
        highlightCol: 1,
      },
      { type: "h2", text: "Why reserve transparency matters to a merchant" },
      {
        type: "p",
        text: `When you accept a stablecoin, you are briefly holding a claim on the issuer's reserves. If the peg wobbles because the market doubts those reserves, you eat the difference on money you have already earned. USDC's monthly attestations and Treasury-heavy reserves make that tail risk easier to reason about. This is the same reason we wrote about [reserve transparency and MiCA](/blog/navigating-mica-auto-swaps-eurc-usdc) — the compliance posture is not paperwork, it is what backs the dollar you just got paid.`,
      },
      { type: "h2", text: "The chain matters as much as the coin" },
      {
        type: "p",
        text: `A stablecoin is only as cheap to accept as the network it settles on. USDC on Ethereum mainnet can cost several dollars in gas per transfer; the same USDC on Arbitrum costs a fraction of a cent. That is why Furlpay settles USDC on Arbitrum One (Chain ID 42161) rather than mainnet — the coin is dollar-stable and the rail is sub-cent. Read [USDC on Arbitrum](/blog/integrating-furlpay-with-arbitrum) for the integration details.`,
      },
      { type: "h2", text: "So which should you accept?" },
      {
        type: "ul",
        items: [
          `Selling mostly to US and EU customers, or care about audit and compliance: accept USDC.`,
          `Selling to a global, crypto-native audience that already holds USDT on exchanges: supporting USDT can reduce customer friction.`,
          `Either way, settle on a low-fee chain like Arbitrum — the network choice affects your cost more than the coin choice does.`,
        ],
      },
      {
        type: "quote",
        text: `Market cap tells you how popular a stablecoin is. Attestations and reserves tell you how safe it is to be paid in one. For a merchant, the second question is the one that costs money.`,
      },
      {
        type: "p",
        text: `This article is informational and not financial or legal advice. Stablecoins carry issuer and peg risk and are not deposit-insured. Compare how acceptance works on our [payments](/products/payments) and [merchant](/products/merchant) pages.`,
      },
    ],
  },
  // 25 ----------------------------------------------------------------
  {
    slug: "how-crypto-payments-work",
    title: "How Do Crypto Payments Work? A Plain-English Guide for Businesses",
    excerpt:
      "No jargon: what actually happens when a customer pays a business in USDC, how settlement differs from cards, what a wallet and gas are, and why on-chain payments are final. A practical primer for merchants.",
    category: "product-news",
    date: "2026-07-06",
    readMins: 8,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `Crypto payments sound complicated and are mostly not. Stripped of jargon, a stablecoin payment is a customer moving digital dollars from their account to yours over a shared ledger, in about a second, for a fraction of a cent. This guide explains what actually happens, in order, and how it differs from the card payment you already understand.`,
      },
      { type: "h2", text: "What is a crypto payment, really?" },
      {
        type: "p",
        text: `A crypto payment is a transfer of value recorded on a blockchain — a shared, tamper-evident ledger that many computers agree on. For payments, the value being moved is usually a stablecoin like USDC, which is pegged one-to-one to the US dollar. So "crypto payment" here does not mean volatile Bitcoin; it means a digital dollar that settles on rails that happen to be built on blockchain technology.`,
      },
      { type: "h2", text: "The five steps of a USDC payment" },
      {
        type: "ul",
        items: [
          `1. Quote: your checkout requests a price. Furlpay creates a payment for, say, $150 in USDC and returns the details.`,
          `2. Authorize: the customer's wallet signs an authorization (an EIP-712 signature) approving the transfer. No card number changes hands.`,
          `3. Screen: both sides are checked against sanctions lists before anything settles — compliance happens inline.`,
          `4. Settle: the USDC moves from customer to merchant on Arbitrum and finalizes in about a second.`,
          `5. Receipt: you get a signed receipt linking to Arbiscan, the public record of the payment, for your books.`,
        ],
      },
      {
        type: "diagram",
        text: `Customer wallet ──authorize──▶ Furlpay ──screen──▶ Arbitrum ──settle──▶ Merchant\n        (signs)              (quote + compliance)     (~1 second)        (receipt)`,
      },
      { type: "h2", text: "What is a wallet? What is gas?" },
      {
        type: "p",
        text: `A wallet is the app that holds the customer's digital dollars and produces the signature that authorizes a payment. Traditional wallets make you back up a twelve-word "seed phrase," which is easy to lose or get phished. Furlpay uses passkey wallets instead — the same Face ID or fingerprint mechanism you already use to sign in — so there is no seed phrase. Gas is the tiny network fee paid to process a transaction; on Arbitrum it is a fraction of a cent, and Furlpay can sponsor it so customers do not need to hold a separate token to pay it. We wrote about [replacing the seed phrase with passkeys](/blog/death-of-the-seed-phrase-webauthn) if you want the security detail.`,
      },
      { type: "h2", text: "How is this different from a card payment?" },
      {
        type: "table",
        headers: ["", "Card payment", "USDC payment"],
        rows: [
          ["Who is in the middle", "Issuer, network, processor", "Almost no one"],
          ["Settlement time", "2-3 business days", "~1 second"],
          ["Typical fee", "2.9% + 30¢", "0.5% + sub-cent gas"],
          ["Reversible?", "Yes (chargebacks)", "No (final on-chain)"],
          ["Works across borders", "With FX fees", "Natively, dollar-stable"],
        ],
        highlightCol: 2,
      },
      {
        type: "p",
        text: `The finality point cuts both ways. No chargebacks means no friendly fraud and no dispute fees for you — but it also means refunds are something you issue deliberately through the API, not something a bank claws back. For a fuller cost breakdown, see [Crypto vs Card Fees: The Real Math](/blog/crypto-vs-card-fees-the-real-math).`,
      },
      { type: "h2", text: "Do my customers need to understand any of this?" },
      {
        type: "p",
        text: `No — and that is the point. A good stablecoin checkout feels closer to a card checkout than to a crypto app: the customer approves with a passkey and the payment settles. The blockchain, the gas, and the screening happen underneath. Your job as a merchant is to add the checkout; Furlpay handles the rest.`,
      },
      { type: "h2", text: "Getting started" },
      {
        type: "p",
        text: `You can accept your first USDC payment from a hosted checkout link without writing code, or integrate the API in an afternoon. Start with the [quickstart](/docs/quickstart), read how [merchant acceptance](/products/merchant) works, or estimate your savings with the [fee calculator](/resources/tools/fee-calculator).`,
      },
      {
        type: "quote",
        text: `A stablecoin payment is just digital dollars moving directly from one account to another, recorded once, and final. Everything else is plumbing you do not have to see.`,
      },
      {
        type: "p",
        text: `Furlpay is not a bank. This guide is informational and not financial advice. On-chain payments are final; issue refunds deliberately through the API.`,
      },
    ],
  },
  // 26 ----------------------------------------------------------------
  {
    slug: "usdc-on-arbitrum-complete-guide",
    title: "USDC on Arbitrum: The Complete Guide for Businesses (2026)",
    excerpt:
      "USDC on Arbitrum One settles in about a second for a fraction of a cent of gas — the combination that makes 0.5% payment pricing viable. Here is how it works, why it matters, and how to accept it.",
    category: "product-news",
    date: "2026-07-06",
    readMins: 7,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `USDC is a dollar-pegged stablecoin issued by Circle. Arbitrum One is an Ethereum Layer 2. Put them together and you get the single most practical rail for stablecoin payments in 2026: digital dollars that move in about a second for a fraction of a cent, with Ethereum-grade security underneath. This guide explains what that means for a business and how to accept it.`,
      },
      { type: "h2", text: "What is USDC on Arbitrum?" },
      {
        type: "p",
        text: `USDC on Arbitrum is the same dollar-pegged token you know, issued natively on the Arbitrum One network (Chain ID 42161) rather than on Ethereum mainnet. Arbitrum batches many transactions and posts proofs back to Ethereum, so it inherits Ethereum's security while spreading the mainnet cost across everyone. The result is a transfer that finalises in roughly a second and costs a tiny fraction of a cent in gas.`,
      },
      {
        type: "table",
        headers: ["", "USDC on Ethereum", "USDC on Arbitrum"],
        rows: [
          ["Typical gas per transfer", "$1 – $5+", "~$0.002 – $0.005"],
          ["Settlement time", "~12 seconds+", "~1 second"],
          ["Security model", "Ethereum L1", "Ethereum L1 (via L2 proofs)"],
        ],
        highlightCol: 2,
      },
      { type: "h2", text: "Why the network matters more than the coin" },
      {
        type: "p",
        text: `A stablecoin is only as cheap to accept as the chain it settles on. The same USDC that costs several dollars to move on Ethereum mainnet costs a fraction of a cent on Arbitrum. That difference is the whole game for payments: it is what allows a 0.5% flat fee and even per-request micropayments, which would be impossible if every transfer cost a dollar in gas. You can compare chains yourself with our [gas cost estimator](/resources/tools/gas-estimator).`,
      },
      { type: "h2", text: "Who is already building here" },
      {
        type: "p",
        text: `Arbitrum is not a fringe choice. Mastercard brought 24/7 stablecoin settlement to Arbitrum, Robinhood built its own chain on Arbitrum Orbit, and Circle supports native USDC on Arbitrum directly. For a business, that ecosystem maturity means liquidity, tooling, and institutional comfort — not an experiment.`,
      },
      { type: "h2", text: "How to accept USDC on Arbitrum" },
      {
        type: "ul",
        items: [
          `Create a payment via the Furlpay API or a hosted checkout link.`,
          `The customer authorises the transfer from a passkey wallet (an EIP-712 signature) — no seed phrase.`,
          `Both sides are screened against sanctions lists, then USDC settles on Arbitrum in about a second.`,
          `You receive a signed receipt linked to Arbiscan for reconciliation.`,
        ],
      },
      {
        type: "p",
        text: `The whole flow costs a flat 0.5% plus sub-cent gas, with no chargebacks. See how it works on the [payments product page](/products/payments), or read the honest cost breakdown in [Crypto vs Card Fees](/blog/crypto-vs-card-fees-the-real-math).`,
      },
      {
        type: "quote",
        text: `USDC gives you dollar stability. Arbitrum gives you speed and near-zero fees. Neither is enough alone — together they are the first stablecoin rail that actually competes with cards on cost.`,
      },
      {
        type: "p",
        text: `This article is informational and not financial advice. Stablecoins carry issuer and peg risk and can lose value.`,
      },
    ],
  },
  // 27 ----------------------------------------------------------------
  {
    slug: "arbitrum-vs-base-for-payments",
    title: "Arbitrum vs Base for Payments: Which Layer 2 Should You Settle On?",
    excerpt:
      "Both are strong Ethereum Layer 2s with sub-cent fees. For stablecoin payments the deciding factors are settlement finality, ecosystem maturity, and where institutional volume already lives. Here is the honest comparison.",
    category: "engineering",
    date: "2026-07-06",
    readMins: 6,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `Arbitrum and Base are both excellent Ethereum Layer 2 networks, both settle USDC for a fraction of a cent, and either would beat card rails on cost. So for a payments business the question is not "which is good" — both are — but which is the better default to settle on. This is our honest take, and why Furlpay chose Arbitrum.`,
      },
      {
        type: "table",
        headers: ["Factor", "Arbitrum One", "Base"],
        rows: [
          ["Type", "Optimistic rollup (Ethereum L2)", "Optimistic rollup (Ethereum L2)"],
          ["Gas per USDC transfer", "~$0.002 – $0.005", "~$0.003 – $0.008"],
          ["Backing", "Offchain Labs / Arbitrum DAO", "Coinbase"],
          ["Institutional footprint", "Mastercard settlement, Robinhood Chain", "Coinbase ecosystem, growing"],
          ["Native USDC", "Yes (Circle)", "Yes (Circle)"],
        ],
        highlightCol: 1,
      },
      { type: "h2", text: "Where they are the same" },
      {
        type: "p",
        text: `Both are optimistic rollups securing to Ethereum, both have native Circle-issued USDC, and both offer sub-cent gas and fast confirmation. For most integrations the developer experience is similar, and Circle's CCTP lets USDC move between them. If your customers or partners are already on Base — for example, deep in the Coinbase ecosystem — settling on Base is entirely reasonable.`,
      },
      { type: "h2", text: "Why Furlpay defaults to Arbitrum" },
      {
        type: "ul",
        items: [
          `Institutional volume already lives there: Mastercard runs 24/7 stablecoin settlement on Arbitrum, and Robinhood built its chain on Arbitrum Orbit.`,
          `Mature Orbit ecosystem: a clear path to an app-specific chain later without changing rails.`,
          `Consistently low, predictable fees for high-frequency payment and agent workloads.`,
        ],
      },
      {
        type: "p",
        text: `None of this makes Base a bad choice — it is a strong network with a large ecosystem. It is a question of defaults, and for a payments and settlement product the institutional gravity around Arbitrum tipped it for us. We go deeper on the rail itself in [USDC on Arbitrum](/blog/usdc-on-arbitrum-complete-guide).`,
      },
      { type: "h2", text: "The practical answer" },
      {
        type: "p",
        text: `Settle where your money and counterparties already are, and where fees are predictably tiny. For most businesses accepting stablecoin payments in 2026, that is Arbitrum — but Base is a close, legitimate second, and multi-chain via CCTP means you are not locked in either way.`,
      },
      {
        type: "quote",
        text: `Both chains make the gas cost a rounding error. So pick on ecosystem and finality, not on a tenth of a cent — and settle where the institutions already do.`,
      },
      {
        type: "p",
        text: `This article is informational and not financial advice.`,
      },
    ],
  },
  // 28 ----------------------------------------------------------------
  {
    slug: "crypto-payments-for-hotels-2026",
    title: "Crypto Payments for Hotels: The Complete 2026 Guide",
    excerpt:
      "International guests, high room rates, and card FX fees make hotels a natural fit for stablecoin payments. Palazzo Versace and Emirates already accept crypto. Here is how any hotel can, at 0.5% and zero chargebacks.",
    category: "product-news",
    date: "2026-07-06",
    readMins: 8,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `Hotels sit at the intersection of every reason stablecoin payments make sense: a high share of international guests, large average transaction sizes, painful foreign-exchange fees on foreign cards, and costly no-show chargebacks. In 2026 the early movers are already here — and any hotel can follow at a flat 0.5% with no chargebacks.`,
      },
      { type: "h2", text: "Who is already accepting crypto" },
      {
        type: "ul",
        items: [
          `Palazzo Versace Dubai accepts Bitcoin, Ethereum and BNB for rooms, dining and spa via a Binance partnership.`,
          `Emirates and Dubai Duty Free have signed with Crypto.com to accept crypto payments, including stablecoins.`,
          `Trip.com integrated USDT and USDC payments for flights and hotels globally.`,
          `Major chains including Marriott, Hilton and Accor are exploring blockchain payments for international guests.`,
        ],
      },
      { type: "h2", text: "Why hotels specifically benefit" },
      {
        type: "table",
        headers: ["Pain point", "On cards", "On USDC (Furlpay)"],
        rows: [
          ["Processing fee", "2.9% – 3.5%", "0.5% flat"],
          ["International guest FX", "1% – 3% extra", "None (dollar-stable)"],
          ["Settlement", "2 – 4 days", "~1 second"],
          ["No-show chargebacks", "Common + dispute fees", "None (on-chain final)"],
        ],
        highlightCol: 2,
      },
      {
        type: "p",
        text: `On a property doing $2M a year in card volume, moving eligible bookings to 0.5% keeps roughly $60,000 that would otherwise go to card networks — before counting avoided chargebacks. Model your own number with the [fee calculator](/resources/tools/fee-calculator) or [ROI calculator](/resources/tools/roi-calculator).`,
      },
      { type: "h2", text: "How it works without changing your PMS" },
      {
        type: "p",
        text: `You do not rip out your property-management system. Furlpay adds a hosted checkout or API alongside it: the guest pays in USDC on Arbitrum from a passkey wallet, you receive a signed receipt, and funds settle in about a second. Refunds are issued deliberately through the API, and a single USDC ledger keeps reconciliation clean.`,
      },
      { type: "h2", text: "Getting started" },
      {
        type: "p",
        text: `Start with the [hotels solution page](/solutions/hotels), or the regional versions for [UK hotels](/uk/solutions/hotels) and [Dubai hotels](/ae/solutions/hotels). A pilot on a single property, run alongside your existing card acceptance, is the low-risk way to prove the savings before rolling out.`,
      },
      {
        type: "quote",
        text: `Your guests already arrive with crypto wallets and international cards. Accepting USDC turns their most expensive-to-process payments into your cheapest — at 0.5%, settled instantly, with no chargebacks.`,
      },
      {
        type: "p",
        text: `Furlpay is not a bank. Figures are illustrative estimates and vary by property. This article is informational, not financial advice.`,
      },
    ],
  },
  // 29 ----------------------------------------------------------------
  {
    slug: "fca-crypto-regulations-2026",
    title: "FCA Crypto Regulations 2026: What UK Businesses Need to Know",
    excerpt:
      "The FCA published final crypto rules on 30 June 2026. The authorisation gateway opens 30 September 2026 and the regime becomes mandatory on 25 October 2027. Here is what UK businesses should understand — plainly.",
    category: "compliance",
    date: "2026-07-06",
    readMins: 7,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1529101091764-c3526daf38fe?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `The UK is building one of the world's clearest crypto regimes, and 2026 is the pivotal year. The FCA published its final core rules on 30 June 2026, the authorisation gateway opens on 30 September 2026, and the new regime becomes mandatory on 25 October 2027. This is a plain-English summary for UK businesses — not legal advice.`,
      },
      { type: "h2", text: "The timeline that matters" },
      {
        type: "table",
        headers: ["Date", "What happens"],
        rows: [
          ["4 Feb 2026", "The FSMA (Cryptoassets) Regulations 2026 bring crypto into the FCA's remit"],
          ["30 Jun 2026", "FCA publishes final core rules and guidance"],
          ["30 Sep 2026", "Authorisation gateway opens; firms can apply (until 28 Feb 2027)"],
          ["25 Oct 2027", "New regime becomes mandatory"],
        ],
        highlightCol: 0,
      },
      {
        type: "p",
        text: `The FCA is offering pre-application support meetings from July 2026, so serious firms are engaging now rather than waiting for the gateway to open.`,
      },
      { type: "h2", text: "Who needs to be authorised" },
      {
        type: "p",
        text: `Firms carrying out regulated cryptoasset activities in the UK — trading platforms, intermediaries, custodians, stablecoin issuers, and firms arranging staking — will need FCA authorisation. If your business only accepts a stablecoin as payment for goods or services, your obligations differ from those of a crypto exchange, but you should still take advice on where you sit.`,
      },
      { type: "h2", text: "The financial promotions rule you cannot ignore" },
      {
        type: "p",
        text: `Separately from authorisation, marketing cryptoassets to UK consumers has been regulated since October 2023 under the financial promotions regime. A promotion must be made by an FCA-authorised person, approved by an authorised "section 21 approver", or fall under an exemption — otherwise it can be a criminal offence. Promotions must carry a prescribed risk warning, cannot offer incentives that induce investment, and give first-time investors a 24-hour cooling-off period.`,
      },
      {
        type: "ul",
        items: [
          `If you market crypto to UK consumers, line up an authorised approver or a clear exemption first.`,
          `Use the FCA's prescribed risk-warning wording.`,
          `Do not offer referral bonuses or cashback that incentivise investment in cryptoassets to UK consumers.`,
        ],
      },
      { type: "h2", text: "How Furlpay approaches it" },
      {
        type: "p",
        text: `We state our position honestly: Furlpay is not yet FCA authorised, because the gateway does not open until 30 September 2026. Our UK pages carry the prescribed risk warning and an accurate status, and we are preparing for the regime. You can read our current position on the [UK trust page](/uk/trust).`,
      },
      {
        type: "quote",
        text: `The UK is not banning crypto — it is professionalising it. Firms that treat authorisation and honest promotions as a feature, not a chore, will be the ones enterprises and regulators trust.`,
      },
      {
        type: "p",
        text: `This article is information, not legal or financial advice. Dates and rules are accurate as of July 2026 and may change; consult qualified counsel about your specific situation.`,
      },
    ],
  },
  // 30 ----------------------------------------------------------------
  {
    slug: "genius-act-2026-what-businesses-need-to-know",
    title: "The GENIUS Act: What US Businesses Need to Know About Stablecoins in 2026",
    excerpt:
      "The GENIUS Act, signed in July 2025, is the first US federal law for payment stablecoins. It regulates issuers like Circle — not merchants — and gives businesses the legal clarity to accept USDC with confidence. Here is the plain-English version.",
    category: "compliance",
    date: "2026-07-06",
    readMins: 7,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1591994843349-f415893b3a6b?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `For years the biggest blocker to stablecoin payments in the US was not technology — it was legal uncertainty. That changed on 18 July 2025, when the GENIUS Act was signed into law. It is the first federal framework for payment stablecoins, and for a business deciding whether to accept USDC, it is the green light that was missing.`,
      },
      { type: "h2", text: "What the GENIUS Act actually does" },
      {
        type: "p",
        text: `The GENIUS Act (Guiding and Establishing National Innovation for U.S. Stablecoins) creates a federal regime for "payment stablecoins" — dollar-pegged tokens like USDC used for payments. It defines who is allowed to issue them and the rules they must follow.`,
      },
      {
        type: "ul",
        items: [
          `Only permitted issuers may issue a payment stablecoin for US persons — a subsidiary of an insured depository institution, or a federally or state-qualified issuer.`,
          `100% reserve backing in liquid assets such as US dollars and short-dated Treasuries, with monthly public disclosure of reserves.`,
          `Issuers are subject to the Bank Secrecy Act — real AML, sanctions screening and customer identification programs.`,
          `Compliant payment stablecoins are carved out of the federal "security" and "commodity" definitions, removing a major source of ambiguity.`,
        ],
      },
      { type: "h2", text: "The key point: it regulates issuers, not merchants" },
      {
        type: "p",
        text: `This is the part most summaries get wrong. The GENIUS Act's obligations fall on the issuer of the stablecoin — for USDC, that is Circle — not on the merchant who accepts it. A hotel or shop accepting USDC is not becoming a regulated stablecoin issuer. What the law gives that business is confidence that the dollar it is being paid in sits inside a federal framework with reserve and disclosure requirements behind it.`,
      },
      {
        type: "quote",
        text: `The GENIUS Act does not make accepting USDC complicated. It makes the USDC you accept trustworthy — federally regulated, fully reserved, and transparently disclosed.`,
      },
      { type: "h2", text: "What it means for your business" },
      {
        type: "table",
        headers: ["Before", "After the GENIUS Act"],
        rows: [
          ["\"Is this even legal?\"", "Federal framework for payment stablecoins"],
          ["Unclear reserve backing", "100% reserves + monthly disclosure required"],
          ["Security/commodity ambiguity", "Carved out for compliant payment stablecoins"],
          ["Patchwork by state", "A federal baseline"],
        ],
        highlightCol: 1,
      },
      {
        type: "p",
        text: `In practice, the legal clarity is what unlocks enterprise adoption. It is a large part of why so many US merchants now accept crypto, and why accepting USDC is a defensible decision for a CFO rather than a risky one.`,
      },
      { type: "h2", text: "How Furlpay fits" },
      {
        type: "p",
        text: `Furlpay is a payments platform, not a stablecoin issuer — we help businesses accept USDC (issued by Circle under the GENIUS Act framework) on Arbitrum for a flat 0.5%. We are honest about our own status and do not claim to be a GENIUS Act issuer. See how acceptance works on the [payments page](/products/payments) and the honest cost breakdown in [Crypto vs Card Fees](/blog/crypto-vs-card-fees-the-real-math).`,
      },
      {
        type: "p",
        text: `This article is information, not legal advice. The GENIUS Act was signed 18 July 2025 and its implementing rules continue to develop; consult qualified counsel about your specific situation.`,
      },
    ],
  },
  // 31 ----------------------------------------------------------------
  {
    slug: "2026-card-fee-changes-hotels",
    title: "The 2026 Card Fee Changes Hotels Should Watch — and the USDC Alternative",
    excerpt:
      "April 2026 brought a wave of card network fee changes — new Mastercard transaction fees, Visa's Level 2 sunset, and revised hotel interchange. Here is what actually changed, honestly, and how USDC at 0.5% compares.",
    category: "product-news",
    date: "2026-07-06",
    readMins: 6,
    author: "Furlpay Team",
    cover: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `Card acceptance costs rarely go down, and April 2026 continued the trend with a set of specific network changes. There was no single dramatic "fees doubled" headline — the reality is more granular, and worth understanding accurately before anyone pitches you a scare story. Here is what actually changed, and how a flat-0.5% USDC rail compares.`,
      },
      { type: "h2", text: "What actually changed in April 2026" },
      {
        type: "ul",
        items: [
          `Mastercard introduced a new Force Post Transaction Fee of about nine cents per transaction in the US, and pricing changes to the Digital Enablement Fee (a minimum around $0.025 on transactions up to $100).`,
          `Mastercard added a new Fallback Avoidance fee.`,
          `Visa began sunsetting its standalone Level 2 (CEDP) interchange incentive for commercial cards, effective mid-April 2026 — relevant to business-card acceptance.`,
          `Discover revised a number of Hotel/Car Rental interchange rates in its April release.`,
        ],
      },
      {
        type: "p",
        text: `None of these is a blanket rate hike, but together they nudge effective acceptance costs up and make card pricing harder to predict — especially for hotels, which sit in specific interchange programs and take a lot of commercial and international cards.`,
      },
      { type: "h2", text: "Why hotels feel it most" },
      {
        type: "p",
        text: `Hotels combine three expensive ingredients: large average tickets, a high share of international and commercial cards, and meaningful chargeback exposure from cancellations and no-shows. Small per-transaction and interchange changes therefore land harder here than in most retail.`,
      },
      {
        type: "table",
        headers: ["", "Cards (2026)", "USDC on Furlpay"],
        rows: [
          ["Headline cost", "~2.9% – 3.5% + new per-tx fees", "0.5% flat"],
          ["International cards", "+ cross-border + FX", "No FX (dollar-stable)"],
          ["Settlement", "2 – 4 days", "~1 second"],
          ["Chargebacks", "Yes + dispute fees", "None (final)"],
          ["Fee predictability", "Changes each release", "One flat rate"],
        ],
        highlightCol: 2,
      },
      { type: "h2", text: "The honest takeaway" },
      {
        type: "p",
        text: `You do not need to drop cards — most guests will still tap a card, and you should let them. The point is to add a cheaper, predictable rail for the guests who can use it. USDC on Arbitrum is a flat 0.5% that does not change every April, settles instantly, and cannot be charged back. On a property doing $2M a year, moving even part of that volume is real money. Model it with the [ROI calculator](/resources/tools/roi-calculator), or read the [hotels guide](/blog/crypto-payments-for-hotels-2026).`,
      },
      {
        type: "quote",
        text: `Card fees are not going to stop drifting up. The hedge is not to fight every interchange release — it is to offer a second rail whose price you actually control.`,
      },
      {
        type: "p",
        text: `Figures are illustrative and based on publicly reported April 2026 network changes; your effective rates vary by processor, card mix and category. This is information, not financial advice.`,
      },
    ],
  },
  // 32 ----------------------------------------------------------------
  {
    slug: "dubai-cashless-2026-hotels-crypto",
    title: "Dubai Cashless 2026: How Hotels Can Accept Crypto Payments",
    excerpt:
      "Dubai is targeting a largely cashless economy, Emirates and Dubai Duty Free are enabling crypto, and Palazzo Versace already accepts it. Here is how any Dubai hotel can accept USDC at 0.5% — and the honest regulatory picture.",
    category: "travel",
    date: "2026-07-06",
    readMins: 7,
    author: "FurlPay Travels",
    cover: "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1600&q=80",
    body: [
      {
        type: "p",
        text: `Few cities are moving toward digital payments as deliberately as Dubai. With a stated goal of a largely cashless economy and a stream of high-value international guests, Dubai's hotels are an almost perfect fit for stablecoin payments — and several of the emirate's biggest names are already there.`,
      },
      { type: "h2", text: "The market is already moving" },
      {
        type: "ul",
        items: [
          `Emirates and Dubai Duty Free have signed agreements with Crypto.com to accept crypto payments, including stablecoins.`,
          `Palazzo Versace Dubai accepts Bitcoin, Ethereum and BNB for rooms, dining and spa via a Binance partnership.`,
          `The UAE has launched DDSC, a Central Bank–approved dirham-backed stablecoin, now available on VARA-regulated platforms.`,
          `Dubai's broader agenda targets a large majority of transactions going cashless.`,
        ],
      },
      { type: "h2", text: "Why Dubai hotels benefit more than most" },
      {
        type: "p",
        text: `Dubai combines the highest international-guest share and among the highest room rates in the world. That is precisely the mix where card interchange and foreign-exchange fees take the biggest absolute bite. Accepting USDC — dollar-stable, borderless — removes the FX cost and drops processing to a flat 0.5%.`,
      },
      {
        type: "table",
        headers: ["Pain point", "On cards", "On USDC (Furlpay)"],
        rows: [
          ["Processing fee", "2.9% – 3.5%", "0.5% flat"],
          ["International-guest FX", "1% – 3% extra", "None"],
          ["Settlement", "2 – 4 days", "~1 second"],
          ["Chargebacks", "Common + fees", "None (final)"],
        ],
        highlightCol: 2,
      },
      { type: "h2", text: "How a Dubai hotel accepts USDC" },
      {
        type: "p",
        text: `Furlpay adds a hosted checkout or API alongside the property's PMS. The guest pays in USDC on Arbitrum from a passkey wallet, the hotel gets a signed receipt, and funds settle in about a second. See the [Dubai hotels page](/ae/solutions/hotels) for the full picture.`,
      },
      { type: "h2", text: "The honest regulatory note" },
      {
        type: "p",
        text: `Dubai's Virtual Assets Regulatory Authority (VARA) requires a licence to offer virtual asset services in or from the emirate. Furlpay is not currently VARA-licensed and is evaluating licensing; our Dubai pages state this plainly and carry a virtual-asset risk note. Any hotel exploring crypto acceptance should confirm its own regulatory position — see our [UAE trust page](/ae/trust).`,
      },
      {
        type: "quote",
        text: `Dubai's guests already arrive with crypto wallets and foreign cards. Accepting USDC turns their most expensive-to-process payments into the cheapest — at 0.5%, instantly, with no FX.`,
      },
      {
        type: "p",
        text: `Furlpay is not a bank and is not currently VARA-licensed. Virtual assets are high risk and can lose value. This article is information, not financial or legal advice.`,
      },
    ],
  },
  {
    slug: "rwa-tokenized-economy-needs-a-settlement-layer",
    title: "The Tokenized Economy Still Needs a Cash Register: Stablecoins as the RWA Settlement Layer",
    excerpt:
      "Roughly $27B of real-world assets are now on-chain and BlackRock's BUIDL alone passed $2.5B. But a tokenized Treasury or hotel share is only half a market — it still needs a payment rail. Here is where stablecoin settlement fits, and where Furlpay honestly does and does not play.",
    category: "product-news",
    date: "2026-07-07",
    cover: "https://images.unsplash.com/photo-1620266757065-5814239881fd?auto=format&fit=crop&w=1600&q=80",
    readMins: 7,
    author: "Furlpay Team",
    body: [
      {
        type: "p",
        text: `Real-world asset (RWA) tokenization stopped being a thesis and became a balance sheet in 2026. On-chain RWA value sits around $26–36B depending on how you count, tokenized US Treasuries alone are roughly $12.9B, and BlackRock's tokenized money-market fund (BUIDL) passed $2.5B in May. Boston Consulting Group and Ripple project the broader market reaching $18.9T by 2033 — a number worth treating as a direction, not a promise, given how wide the published estimates run.`,
      },
      {
        type: "p",
        text: `Ahead of the RWA Week panel "Who Owns the Tokenized Economy" (8 July 2026), it is worth being precise about one layer everyone assumes and few build: settlement. A tokenized asset is a claim. Turning that claim into money still needs a payment rail — and that is a different problem from issuing the token.`,
      },
      { type: "h2", text: "Tokenization solves ownership, not payment" },
      {
        type: "p",
        text: `Tokenizing an asset answers "who owns this, and can I transfer a fraction of it." It does not answer "how does the coupon get paid, how does a buyer settle, how does a guest actually pay the hotel whose shares were just tokenized." Those are settlement questions, and today they mostly fall back to bank wires (multi-day) or card rails (1.5–3.5% and chargeback-prone) — the exact frictions tokenization set out to remove.`,
      },
      {
        type: "table",
        headers: ["Layer", "What it does", "Who builds it"],
        rows: [
          ["Issuance", "Mints the token that represents the asset", "Ondo, Franklin Templeton, BlackRock/Securitize"],
          ["Marketplace", "Lists and trades the tokenized asset", "InvestaX, tokenization platforms, exchanges"],
          ["Settlement", "Moves money for the trade, coupon or real-world use", "Stablecoin payment rails"],
        ],
        highlightCol: 2,
      },
      { type: "h2", text: "Where stablecoins fit — and where Furlpay does" },
      {
        type: "p",
        text: `Stablecoins are the natural settlement asset for tokenized markets: dollar-stable, borderless, final in about a second on a network like Arbitrum. Furlpay builds that settlement layer — a USDC payments API that settles on Arbitrum for a flat 0.5%, plus an x402 facilitator so machines and platforms can pay per call. That is the honest edge of what we do.`,
      },
      {
        type: "p",
        text: `We should be equally clear about what we do not do. Furlpay is not an RWA issuer. We do not tokenize hotels, issue fractional property shares, or operate a securities marketplace, and nothing here is an offer of any tokenized investment. Our role is upstream of ownership and downstream of it: the rail that moves dollars when a tokenized asset needs to be paid for, or when the real-world business behind it — a hotel, an airline, a merchant — takes a payment.`,
      },
      { type: "h2", text: "The concrete example: tokenized hospitality" },
      {
        type: "p",
        text: `Take a hotel whose ownership is tokenized so global investors can hold a fraction. That structure is only compelling if the underlying property runs efficiently — and a property that still pays 3% plus FX on every international guest is leaking yield the tokenization was supposed to unlock. A hotel accepting USDC at 0.5% ([see how](/solutions/hotels)) improves the real cash flows the token is a claim on. Settlement and ownership are two ends of the same asset.`,
      },
      { type: "h2", text: "Public rails, regulated wrappers" },
      {
        type: "p",
        text: `The regulatory direction reinforces this. The US GENIUS Act, the EU's MiCA, Japan's June 2026 recognition of USDC as an Electronic Payment Instrument, and Dubai's VARA regime all point the same way: regulated wrappers on top of public blockchains, not walled-garden chains. Settlement infrastructure that is compliance-aware on a public network is exactly the shape those frameworks reward. Furlpay states its own regulatory status plainly on each market's trust page rather than overclaiming it.`,
      },
      {
        type: "quote",
        text: `A tokenized asset without a settlement rail is a share certificate you cannot cash. The tokenized economy will be owned by whoever makes the money move — cheaply, instantly, and within the rules.`,
      },
      {
        type: "p",
        text: `Furlpay is not a bank and is not an issuer of securities or tokenized real-world assets. Crypto assets are high risk and can lose value. Market figures are third-party estimates as of mid-2026 and vary by source. This article is information, not financial or legal advice.`,
      },
    ],
  },
  {
    slug: "usdc-legal-in-japan-2026-what-it-means-for-payments",
    title: "USDC's Legal Path in Japan: What the June 2026 Stablecoin Rules Mean for Payments",
    excerpt:
      "From 1 June 2026, qualifying foreign stablecoins can be distributed in Japan under the Payment Services Act — with USDC's pathway running through SBI VC Trade. Here is what actually changed, why USDT still can't clear the bar, and what it means for hotels and merchants.",
    category: "compliance",
    date: "2026-07-07",
    cover: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1600&q=80",
    readMins: 7,
    author: "Compliance Team",
    body: [
      {
        type: "p",
        text: `For years, using a dollar stablecoin to pay in Japan sat in a grey zone. That changed in June 2026. Under an update to the Payment Services Act effective 1 June 2026, qualifying foreign stablecoins can now be distributed in Japan through licensed intermediaries, regulated by the Financial Services Agency (JFSA) as Electronic Payment Instruments (EPI). For a business deciding whether to accept USDC, that is the legal clarity that was missing.`,
      },
      { type: "h2", text: "What actually changed" },
      {
        type: "p",
        text: `Japan's framework treats fiat-backed stablecoins as Electronic Payment Instruments, and a foreign stablecoin can only be offered through a registered Electronic Payment Instrument Exchange Service Provider (EPIESP) after clearing a JFSA "equivalence" test on its issuer and reserves. The practical result is a short, curated list of stablecoins that are actually usable on licensed platforms.`,
      },
      {
        type: "table",
        headers: ["Stablecoin", "Status in Japan", "Pathway"],
        rows: [
          ["USDC", "Usable via licensed distribution", "SBI VC Trade (registered EPIESP) + Circle"],
          ["RLUSD", "First foreign stablecoin to clear JFSA equivalence", "SBI VC Trade / Ripple, June 2026"],
          ["JPYC", "Legal domestic yen stablecoin", "JPYC Inc. (licensed issuer)"],
          ["USDT", "Not available on licensed platforms", "No registered distributor"],
        ],
        highlightCol: 0,
      },
      {
        type: "p",
        text: `Two nuances the headlines flatten. First, USDC's route to market is its distribution partnership with SBI VC Trade, which registered as an EPIESP — the token is usable, but through that regulated channel rather than freely. Second, Ripple's RLUSD was actually the first foreign-issued stablecoin to formally clear the JFSA equivalence test in June 2026, also via SBI. USDT, by contrast, has no licensed distributor and remains effectively unavailable on regulated Japanese platforms.`,
      },
      { type: "h2", text: "Why it matters for hotels and merchants" },
      {
        type: "p",
        text: `Japan drew over 40 million inbound visitors in 2025, a growing share of whom carry stablecoins. A hotel, ryokan or merchant that accepts USDC through a compliant pathway can serve that demand while cutting processing from the 3–4% typical of Japanese cards (plus FX on foreign cards) to a flat 0.5%, settled in about a second with no chargebacks. Retail precedent already exists — major electronics chains have accepted crypto for years — so acceptance is not the leap it once was.`,
      },
      {
        type: "ul",
        items: [
          `Legal clarity: USDC is a recognised Electronic Payment Instrument, not a grey-area asset.`,
          `Lower cost: 0.5% versus 3–4% card-plus-FX on inbound guests.`,
          `Finality: on-chain settlement removes chargebacks on high-value ryokan and hotel stays.`,
          `Omotenashi: one less point of friction at checkout, complementing service rather than replacing it.`,
        ],
      },
      { type: "h2", text: "Furlpay's honest status in Japan" },
      {
        type: "p",
        text: `Furlpay is a payments platform, not a stablecoin issuer or a JFSA-registered exchange. We are not registered with the JFSA as a Crypto-Asset Exchange Service Provider or an EPIESP, and we do not claim to be — those registrations require a local presence and are how distribution is licensed in Japan. We are evaluating a licensed-intermediary pathway and state exactly where we stand on our [Japan trust page](/jp/trust). See how acceptance works for [Japanese hotels](/jp/solutions/hotels).`,
      },
      {
        type: "p",
        text: `Furlpay is not a bank and is not registered with the JFSA. Crypto assets are high risk, are not legal tender, and can lose value. Regulatory details are accurate to the best of our knowledge as of July 2026 and continue to develop; consult qualified Japanese counsel about your specific situation. This article is information, not legal advice.`,
      },
    ],
  },
  // -----------------------------------------------------------------
  {
    slug: "stablecoin-payment-rails-upi-solana-polygon",
    title: "The Stablecoin Rail Question: UPI vs Solana vs Polygon — and Where Furlpay Settles",
    excerpt:
      "Every serious payments platform now has to pick a settlement layer. We compared UPI, Solana and Polygon on the metrics that actually matter for moving a stablecoin dollar across borders — cost, finality, liquidity and AI-agent readiness. The honest answer is not one rail, it is stablecoins on the right rail for each job.",
    category: "product-news",
    date: "2026-07-07",
    readMins: 11,
    author: "Furlpay Team",
    body: [
      {
        type: "p",
        text: `Ask ten fintech founders which payment rail they are building on and you will get ten answers. Ask what they are actually moving, and you get one: a stablecoin. The rail is the road; the stablecoin is the car. For a travel platform like Furlpay — cross-border payments, virtual card issuance, and AI agents that book hotels on their own — the road you pick decides how fast, how cheap, and how programmable that dollar can be.`,
      },
      {
        type: "p",
        text: `So we ran the comparison the way an operator would, not a chain maximalist. We put India's [UPI](https://www.npci.org.in/what-we-do/upi/product-overview) — the world's largest real-time retail rail — next to Solana and Polygon, the two chains carrying the most stablecoin volume in 2026. This post is deliberately narrow: not "which chain is best," but "which rail moves a stablecoin dollar best, for which job." That distinction is the whole ballgame.`,
      },
      { type: "h2", text: "The one metric that reframes everything: stablecoin support" },
      {
        type: "p",
        text: `Start with the fact that ends the debate for a global product before it begins. UPI, for all its dominance, does not carry stablecoins at all. It is a sovereign rail that moves rupees between Indian bank accounts, brilliantly, at a scale no blockchain has matched — but it cannot hold, transfer or settle USDC. Solana and Polygon are stablecoin-native by design. Once your product needs to move value across a border in a dollar-denominated asset, UPI stops being a competitor and becomes something more useful: an on-ramp.`,
      },
      {
        type: "table",
        headers: ["What you care about", "UPI (NPCI)", "Solana", "Polygon (PoS)"],
        rows: [
          ["Carries stablecoins?", "No — INR only", "Yes — USDC, USDT, PYUSD, EURC", "Yes — USDC, USDT (EVM)"],
          ["Programmable (smart contracts)", "No", "Yes", "Yes (EVM)"],
          ["Typical finality", "Instant (fiat ledger)", "Sub-second (~400ms)", "~2-3s (PoS)"],
          ["Fee to move a payment", "Zero MDR (bank-subsidised)", "Fractions of a cent", "~1-5 cents"],
          ["Geography", "India only", "Global", "Global"],
          ["AI-agent / x402 ready", "No", "Yes", "Yes"],
        ],
        highlightCol: 0,
      },
      {
        type: "p",
        text: `Read that table the way a treasury team would: UPI wins the domestic-India row outright and loses every cross-border and programmability row by default. That is not a knock on UPI — it is doing exactly what a national instant-payment system is supposed to do. It is a statement about scope. A borderless travel wallet lives in the rows where UPI is marked "No."`,
      },
      { type: "h2", text: "Why stablecoins, specifically — not just 'crypto'" },
      {
        type: "p",
        text: `A stablecoin is the only crypto instrument that behaves like the thing a traveller actually wants to hold: a dollar (or euro) that does not swing 8% while they sleep. That price stability is what makes it a payment rail rather than a speculation. When a customer in Lagos books a hotel in Lisbon, the value that leaves their wallet and the value that lands with the merchant have to be the same number. Stablecoins guarantee that; volatile tokens cannot.`,
      },
      {
        type: "ul",
        items: [
          `Settlement is final and near-instant — no multi-day correspondent-bank chain, no Swift message sitting in a queue over a weekend.`,
          `The unit is a dollar, so pricing, refunds and accounting stay legible to a merchant who has never touched a blockchain.`,
          `It is programmable — an escrow can hold a booking deposit and release it on check-in, all in code, with no card processor in the loop.`,
          `It settles the same way at 3pm on a Tuesday and 3am on a Sunday. Payment rails that observe banking hours do not.`,
        ],
      },
      {
        type: "p",
        text: `This is why the largest names in payments spent the last two years moving the same direction. Mastercard brought stablecoin settlement on-chain, Visa piloted USDC settlement with acquirers, and Stripe [relaunched crypto checkout](https://stripe.com/use-cases/crypto) settling merchants in stablecoins. None of them adopted "crypto." They adopted stablecoins. The rail was a downstream decision.`,
      },
      { type: "h2", text: "Cost of moving a stablecoin dollar" },
      {
        type: "p",
        text: `For a low-margin travel booking, the fee to move money is not a rounding error — it is a slice of the profit on every transaction. Here is the picture per million dollars settled, using published fee ranges rather than best-case marketing numbers.`,
      },
      {
        type: "table",
        headers: ["Rail", "Per-transaction fee", "Cost per $1M settled", "Notes"],
        rows: [
          ["Solana", "~$0.00025", "~$1", "Cheapest at scale; sub-second finality"],
          ["Polygon PoS", "~$0.01-0.05", "~$10-50", "EVM liquidity; fees track Ethereum congestion"],
          ["UPI (domestic INR)", "Zero MDR", "~$0", "Free to users, but bank/government subsidised — and INR-only"],
          ["Card rails (reference)", "1.5-3.5%", "$15,000-35,000", "The baseline stablecoins are undercutting"],
        ],
        highlightCol: 0,
      },
      {
        type: "p",
        text: `The gap between the stablecoin rows and the card row is three to four orders of magnitude. That is the entire economic case for stablecoin payments in one table. Between Solana and Polygon the absolute difference is cents, which matters enormously at micropayment scale (an AI agent paying per API call) and rounds to noise for a $400 hotel booking. So "cheapest chain" is the wrong question. "Cheapest chain for this specific payment size" is the right one.`,
      },
      { type: "h2", text: "The new customer: AI agents pay in stablecoins by default" },
      {
        type: "p",
        text: `The fastest-growing payer of 2026 is not a person with a card — it is software. The [x402 protocol](https://www.x402.org/) revives HTTP's dormant 402 "Payment Required" status so an autonomous agent can pay per request in stablecoins, with no account and no card on file. An agent booking a trip does not open a checkout page; it hits an endpoint, receives a 402 with a price, pays in USDC, and retries. That flow only works on a rail that is stablecoin-native and programmable — which rules UPI out entirely and puts Solana and Polygon (and Furlpay's home rail, Arbitrum) squarely in scope.`,
      },
      {
        type: "diagram",
        text: `AI agent                     Furlpay x402 endpoint
   |                                   |
   |------ GET /api/travel/search ---->|
   |                                   |
   |<----- 402 Payment Required -------|   price quote, in USDC,
   |        (quote + pay-to)           |   bound to this exact request
   |                                   |
   |--- sign stablecoin authorization->|
   |                                   |   nonce checked, sanctions
   |                                   |   screened, settled on-chain
   |<---------- 200 OK ----------------|
   |          (search results)         |`,
      },
      {
        type: "p",
        text: `Furlpay runs its own x402 facilitator across Arbitrum, Base and Solana, built around the attack classes documented in recent x402 security research (see ["Free-Riding the Agentic Web"](https://arxiv.org/abs/2605.30998)): quotes are cryptographically bound to the resource they price, nonces are single-use, and malformed payment headers fail closed. The point is not which chain the agent pays on — it is that the payment is a stablecoin, and the rail is interchangeable underneath.`,
      },
      { type: "h2", text: "So which rail wins? The wrong question." },
      {
        type: "p",
        text: `A research report can crown a single winner because it optimises one number. An operator cannot, because different payments have different shapes. A sub-cent AI-agent micropayment, a $400 cross-border hotel booking and an Indian traveller topping up their wallet in rupees are three different jobs, and no single rail is best at all three. Forcing them onto one chain is how you end up paying Solana's speed tax on an EVM-liquidity problem, or trying to route a stablecoin through a rail that cannot hold one.`,
      },
      {
        type: "p",
        text: `Furlpay's answer is stablecoin-first and multi-rail. The stablecoin is the constant; the rail is chosen per job.`,
      },
      {
        type: "table",
        headers: ["Job", "Rail we use", "Why"],
        rows: [
          ["Core settlement & booking escrow", "Arbitrum (USDC)", "Sub-cent fees, Ethereum-grade security, deep stablecoin liquidity — the same rail Mastercard and Robinhood chose"],
          ["AI-agent x402 payments", "Arbitrum / Base / Solana", "Meet agents on whichever stablecoin rail they already hold value on"],
          ["EVM enterprise liquidity", "Polygon / Base via Circle CCTP", "Bridge institutional USDC in without slippage, settle back to the core"],
          ["Local fiat on/off-ramp", "UPI (India), Pix (Brazil), FedNow (US)", "Convert INR/BRL/USD to a stablecoin at the edge — never the core ledger"],
        ],
        highlightCol: 1,
      },
      {
        type: "p",
        text: `Note where UPI lands: not as a rejected competitor, but as the best on-ramp in the world for its market. An Indian traveller funds their Furlpay wallet in rupees over UPI, that value converts to USDC through a domestic partner, and from there it moves globally on a programmable rail. UPI does the one thing it is unmatched at — getting rupees into the system instantly and for free — and hands off to a stablecoin for everything that crosses a border.`,
      },
      { type: "h2", text: "The bottom line" },
      {
        type: "p",
        text: `The rail debate is a proxy for a decision that was already made: payments are going stablecoin-native. UPI proves a national rail can move billions of transactions but cannot carry a dollar across a border. Solana and Polygon prove a stablecoin can settle globally in seconds for cents. The winning architecture is not a chain — it is a stablecoin, settled on the right rail for each job, with local instant-payment systems feeding the edges. That is the system Furlpay is building: [pay in USDC, book 2.2M+ stays and flights](https://furlpay.com), and let AI agents pay per request via x402 — settled on Arbitrum, bridged where it needs to be, and ramped from wherever the money starts.`,
      },
    ],
  },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Deterministic date formatting — avoids timezone drift from Date parsing.
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function getSortedPosts(): Post[] {
  return [...POSTS].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getFeatured(): Post {
  return POSTS.find((p) => p.featured) ?? getSortedPosts()[0];
}

export function getPost(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export function postsByCategory(category: CategoryId): Post[] {
  return getSortedPosts().filter((p) => p.category === category);
}
