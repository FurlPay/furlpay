// ---------------------------------------------------------------------------
// Glossary — the informational layer.
//
// Every surface this app has answers a transactional query: "send USDC",
// "buy NVDA", "book a hotel in Dubai". None of them answer "what is a
// stablecoin", which is the question a person asks *first* and the one that
// AI answer engines are asked most often. That gap is why this file exists.
//
// Two rules govern entries, and both exist because this is YMYL content:
//
//   1. A definition states what a thing IS. It does not sell. Where Furlpay is
//      mentioned it is as a concrete example of the mechanism, never as a
//      recommendation, because a glossary that argues is not a glossary.
//   2. No number appears here that is not either definitional (USDC is
//      1:1-backed by construction) or independently checkable. Rates, yields,
//      volumes and market sizes are deliberately absent: they age badly, and a
//      stale number in a definition reads as authoritative long after it stops
//      being true.
//
// Each term becomes /learn/<slug> with DefinedTerm schema inside a
// DefinedTermSet, which is the vocabulary Google and the answer engines use to
// recognise a glossary as a glossary rather than as thin content.
// ---------------------------------------------------------------------------

export type TermCategory =
  | "Stablecoins"
  | "Payments"
  | "Investing"
  | "Agentic AI"
  | "Compliance"
  | "Security";

export interface Term {
  slug: string;
  term: string;
  /** Expanded form, when the term is an initialism. */
  expansion?: string;
  category: TermCategory;
  /** The answer, in 40–60 words. This is what a featured snippet lifts. */
  short: string;
  /** Paragraphs of detail. Plain prose — no marketing. */
  body: string[];
  /** Slugs of related terms; rendered as internal links. */
  see?: string[];
}

export const TERMS: Term[] = [
  {
    slug: "stablecoin",
    term: "Stablecoin",
    category: "Stablecoins",
    short:
      "A stablecoin is a cryptocurrency designed to hold a constant value against a reference asset, almost always a national currency. Unlike bitcoin, whose price floats, a stablecoin targets one unit of its reference — one USDC is intended to be worth one US dollar at all times.",
    body: [
      "The mechanism that holds the peg is what distinguishes one stablecoin from another, and it is the only part worth understanding. A fiat-backed stablecoin holds reserves — cash and short-term government debt — with a custodian, and honours redemptions at par. A crypto-collateralised stablecoin is over-collateralised with volatile assets and liquidates positions when coverage falls. An algorithmic stablecoin holds its peg through supply adjustments rather than reserves, a design that has failed repeatedly and at scale.",
      "The distinction matters because the risks are entirely different. A fiat-backed coin carries custody and counterparty risk: the peg depends on the reserves existing and being redeemable. A crypto-collateralised coin carries liquidation risk during sharp drawdowns. The three are often discussed as one asset class, and they are not.",
      "For payments specifically, the relevant properties are settlement speed and finality rather than yield. A stablecoin transfer settles on-chain in seconds and cannot be reversed by the sender, which is the opposite of a card payment's chargeback window — an advantage for the merchant and a reason for the payer to verify the recipient before sending.",
    ],
    see: ["usdc", "eurc", "settlement-finality", "mica"],
  },
  {
    slug: "usdc",
    term: "USDC",
    expansion: "USD Coin",
    category: "Stablecoins",
    short:
      "USDC is a fiat-backed stablecoin issued by Circle, designed to hold a 1:1 value against the US dollar. Reserves are held in cash and short-dated US Treasuries with regulated custodians, and Circle publishes regular attestations of those holdings.",
    body: [
      "USDC is natively issued on several blockchains rather than bridged between them, which matters more than it sounds. A bridged token is a claim on a lock-up contract on another chain, and it inherits that bridge's security. Natively-issued USDC on Arbitrum, Base, Solana or Ethereum is the real thing on each chain, with no bridge in the trust path.",
      "The practical consequence for anyone building payments is that the contract address differs per chain and the wrong address means lost funds. Native USDC and bridged USDC.e are distinct tokens with distinct addresses on the same network, and sending one to a contract expecting the other is an ordinary and unrecoverable mistake.",
    ],
    see: ["stablecoin", "eurc", "cctp"],
  },
  {
    slug: "eurc",
    term: "EURC",
    expansion: "Euro Coin",
    category: "Stablecoins",
    short:
      "EURC is a euro-denominated stablecoin issued by Circle, holding a 1:1 target against the euro with reserves held in euro-denominated assets. It is the euro counterpart to USDC and uses the same issuance and redemption model.",
    body: [
      "EURC exists because a dollar stablecoin is a currency conversion for anyone who does not price in dollars. A European merchant accepting USDC takes FX risk between receipt and conversion; accepting EURC removes that leg entirely.",
      "Under the EU's MiCA regime, euro-denominated e-money tokens face specific issuance and reserve requirements, which is a large part of why euro stablecoins have developed differently from dollar ones.",
    ],
    see: ["usdc", "stablecoin", "mica"],
  },
  {
    slug: "settlement-finality",
    term: "Settlement finality",
    category: "Payments",
    short:
      "Settlement finality is the point at which a payment becomes irreversible. Before finality a transfer can be reversed or reordered; after it, the recipient holds the value unconditionally. Different systems reach finality on very different timescales.",
    body: [
      "Card payments reach finality slowly and conditionally: authorisation is immediate, but the payment can be disputed and clawed back for months. Bank wires are typically final on settlement but move only during banking hours. A blockchain transaction reaches probabilistic finality within seconds to minutes depending on the chain, and deterministic finality when the network's consensus rules consider the block irreversible.",
      "The distinction shapes product design more than any other property. Chargeback risk is why card processors hold merchant reserves and price risk into fees. A rail with fast, unconditional finality removes that cost — and simultaneously removes the buyer protection that chargebacks provide, which is a real trade rather than a free win.",
    ],
    see: ["stablecoin", "x402"],
  },
  {
    slug: "x402",
    term: "x402",
    category: "Agentic AI",
    short:
      "x402 is a payment protocol built on HTTP status code 402 (\"Payment Required\"). A server responds 402 with machine-readable payment requirements; the client pays and retries the request with a payment header; the server verifies and releases the resource. It is designed for per-request payments by software rather than people.",
    body: [
      "HTTP 402 was reserved in the original specification and left unimplemented for decades because there was no payment rail a server could demand and verify without a human in the loop. Stablecoins on public chains supply that rail, which is why the status code has become useful now rather than in 1997.",
      "The design target is machine clients. An AI agent calling a metered API cannot enter card details, and issuing it a long-lived API key with a billing account attached transfers unlimited spending authority to a non-deterministic process. Per-request payment bounds the exposure to the value of a single call.",
      "Being a payment protocol operated by autonomous software, x402 has a threat model that ordinary checkout flows do not — see the entry on agentic payment security.",
    ],
    see: ["agentic-payment-security", "settlement-finality", "mcp"],
  },
  {
    slug: "agentic-payment-security",
    term: "Agentic payment security",
    category: "Security",
    short:
      "Agentic payment security covers the failure modes specific to payments initiated by autonomous software rather than people. The distinctive risks are substitution between resources, duplicate settlement under concurrency, spending beyond an authorised allowance, and pricing that the payer cannot verify before paying.",
    body: [
      "Academic work on x402 facilitators catalogues five flaw classes: cross-resource substitution, duplicate-settlement races, allowance overdraft, denial of settlement, and hidden-compute pricing (Ling et al., arXiv:2605.30998).",
      "Four of the five admit engineering fixes. Substitution is closed by binding a payment to a specific resource with a signed commitment, so an authorisation for one endpoint cannot unlock another. Duplicate settlement is closed by making nonces single-use through an atomic claim that is linearised across every server instance — an in-memory set is not sufficient on serverless infrastructure, where each instance holds its own copy. Overdraft is closed by reserving against an allowance before committing. Denial of settlement is bounded by capacity limits with backpressure.",
      "The fifth, hidden-compute pricing, is different in kind. A client cannot verify in advance that the compute it is being charged for was actually performed, so the honest description is mitigation — pricing models that make systematic overcharging detectable over time — rather than a fix. Treating it as solved is the mistake worth avoiding.",
    ],
    see: ["x402", "webauthn", "mcp"],
  },
  {
    slug: "mcp",
    term: "MCP",
    expansion: "Model Context Protocol",
    category: "Agentic AI",
    short:
      "The Model Context Protocol is an open standard for connecting AI models to external tools and data over JSON-RPC. An MCP server exposes capabilities — queries, actions, resources — that a model can invoke through a uniform interface rather than a bespoke integration per application.",
    body: [
      "MCP matters for financial software because it makes the boundary explicit. A model does not receive an account; it receives a set of named capabilities, each with a schema, each individually authorised. That is a far easier surface to reason about than an agent holding credentials directly.",
      "Where a capability moves money, the protocol boundary is the natural place to require human approval. The model can propose a transfer; the approval step belongs outside the model's control, which is what a passkey prompt on the owner's device achieves.",
    ],
    see: ["x402", "webauthn", "agentic-payment-security"],
  },
  {
    slug: "webauthn",
    term: "WebAuthn",
    expansion: "Web Authentication",
    category: "Security",
    short:
      "WebAuthn is a web standard for authenticating with public-key cryptography instead of shared secrets. The private key never leaves the user's device, and signatures are bound to the requesting site's origin, which makes credentials useless to a phishing site even if the user is fully deceived.",
    body: [
      "The origin binding is the property that matters. A password can be typed into any convincing replica of a login page; a passkey signature is scoped to the origin that requested it, so a look-alike domain receives a signature it cannot use. This closes the attack that causes most account takeovers, rather than making it harder.",
      "For payments, WebAuthn also supports step-up: requiring a fresh signature for an individual action rather than only at sign-in. That is what makes \"the model proposes, the human disposes\" enforceable rather than aspirational — an agent can prepare a transfer, but the approval is a cryptographic act performed on the owner's hardware.",
    ],
    see: ["passkey", "agentic-payment-security", "mpc"],
  },
  {
    slug: "passkey",
    term: "Passkey",
    category: "Security",
    short:
      "A passkey is a WebAuthn credential stored on a user's device or in their platform keychain, unlocked by biometrics or a device PIN. It replaces a password with a key pair: the site stores a public key, and the private key never leaves the device.",
    body: [
      "Passkeys are commonly synced through a platform keychain, which makes them recoverable across a user's devices — a meaningful usability difference from hardware security keys, and a meaningful change in the threat model, since the sync provider becomes part of the trust path.",
      "The security property people most often misstate is that passkeys prevent phishing. More precisely: they prevent credential phishing. A user can still be socially engineered into approving a transaction they should not approve. What they cannot do is hand a working credential to an attacker.",
    ],
    see: ["webauthn", "mpc"],
  },
  {
    slug: "mpc",
    term: "MPC",
    expansion: "Multi-party computation",
    category: "Security",
    short:
      "Multi-party computation lets several parties jointly compute a result without any of them learning the others' inputs. Applied to wallets, it splits a private key into shares held separately, so a transaction can be signed without the whole key ever existing in one place.",
    body: [
      "The point is the absence of a single compromise target. A conventional key exists in full somewhere, at least momentarily, and whatever holds it becomes the thing an attacker must reach. In a 2-of-2 scheme with one share bound to the user's device and one held in server-side hardware, compromising either alone yields nothing usable.",
      "The trade is operational rather than cryptographic: recovery must be designed deliberately, because losing a share means losing signing ability, and any recovery path is also a potential bypass. That design — not the signing scheme — is where MPC deployments usually succeed or fail.",
    ],
    see: ["passkey", "webauthn", "erc-4337"],
  },
  {
    slug: "erc-4337",
    term: "ERC-4337",
    expansion: "Account abstraction",
    category: "Payments",
    short:
      "ERC-4337 is an Ethereum standard that lets a smart contract act as a user's account without changing the protocol itself. It enables features an ordinary key-pair account cannot have: spending policies, session limits, social recovery, and transaction fees paid by a third party.",
    body: [
      "The standard routes user intents through a separate mempool of \"user operations\" that bundlers submit on-chain, with an optional paymaster covering gas. That paymaster is what allows an application to sponsor fees so a user can transact holding only a stablecoin and no native token — removing the single most common reason a first transaction fails.",
      "For payments, the significant capability is enforcing policy in the account rather than in the interface. Per-transaction limits and allowlists implemented in a contract hold regardless of which client signs, whereas the same rules implemented in an app are only as good as the app.",
    ],
    see: ["mpc", "cctp"],
  },
  {
    slug: "cctp",
    term: "CCTP",
    expansion: "Cross-Chain Transfer Protocol",
    category: "Payments",
    short:
      "CCTP is Circle's protocol for moving USDC between blockchains by burning it on the source chain and minting it on the destination. Because no wrapped token or bridge custody is involved, the USDC that arrives is natively issued rather than a claim on a locked balance.",
    body: [
      "Conventional bridges lock tokens on one chain and mint a representation on another, which concentrates value in the lock-up contract and makes it a standing target — the pattern behind several of the largest exploits in the sector. Burn-and-mint removes that pool: there is nothing locked to steal.",
      "The trust assumption moves rather than vanishing. Attestation that a burn occurred is issued by the protocol operator, so the model is trust in the issuer instead of trust in a bridge contract. That is a different risk, and for most treasury use a smaller one, but it is not the absence of risk.",
    ],
    see: ["usdc", "erc-4337"],
  },
  {
    slug: "mica",
    term: "MiCA",
    expansion: "Markets in Crypto-Assets Regulation",
    category: "Compliance",
    short:
      "MiCA is the European Union's regulatory framework for crypto-assets, establishing authorisation, reserve, disclosure and conduct requirements for issuers and service providers. It creates a single EU-wide regime in place of divergent national rules.",
    body: [
      "For stablecoins specifically, MiCA distinguishes e-money tokens referencing a single currency from asset-referenced tokens referencing a basket, and imposes reserve, redemption and reporting obligations on issuers of both.",
      "The practical consequence for a platform serving EEA users is that which stablecoins may be offered depends on the issuer's authorisation status, and that this is a routing decision rather than a disclosure one — it determines what the user can hold, not merely what they are told.",
    ],
    see: ["genius-act", "travel-rule", "stablecoin"],
  },
  {
    slug: "genius-act",
    term: "GENIUS Act",
    category: "Compliance",
    short:
      "The GENIUS Act is US federal legislation establishing a regulatory framework for payment stablecoins, covering who may issue them, what reserves must back them, and how holders may redeem them.",
    body: [
      "The significance is that it defines a category. Before a federal framework, payment stablecoins were regulated through a patchwork of state money-transmitter licensing and enforcement actions, which made the compliant path ambiguous rather than difficult.",
      "For platforms, the operative question becomes whether a given stablecoin is issued by an authorised entity — an allowlist decision that has to be enforced in code rather than asserted in a policy document.",
    ],
    see: ["mica", "travel-rule"],
  },
  {
    slug: "travel-rule",
    term: "Travel Rule",
    category: "Compliance",
    short:
      "The Travel Rule requires financial institutions — and, under FATF guidance, virtual asset service providers — to transmit originator and beneficiary information alongside transfers above a threshold, so that identifying data accompanies the value.",
    body: [
      "Applying a rule written for correspondent banking to public blockchains is genuinely awkward: the value moves on a permissionless network while the identifying data must travel through a separate channel between providers, and the two have to be reconciled.",
      "In practice this means a compliant transfer above the threshold generates a structured payload exchanged provider-to-provider, keyed to the on-chain transaction. Transfers to self-hosted wallets, which have no provider on the other side, are the part of the rule where jurisdictions differ most.",
    ],
    see: ["mica", "genius-act"],
  },
  {
    slug: "fractional-shares",
    term: "Fractional shares",
    category: "Investing",
    short:
      "A fractional share is a portion of a single share of stock. Fractional investing lets someone place an order in currency terms — a fixed dollar amount — rather than in whole shares, which makes high-priced securities accessible at any budget.",
    body: [
      "Fractional positions are held in book-entry form by the broker rather than registered directly, which is why fractional shares generally cannot be transferred between brokers and are liquidated on account transfer instead.",
      "Corporate actions are where fractional accounting gets demanding. Dividends must be apportioned and may be subject to withholding; splits, mergers and spin-offs each change the position in ways that have to be recorded per lot if cost basis is to remain correct. A ledger that tracks lots individually is the difference between a defensible tax position and an approximation.",
    ],
    see: ["cost-basis", "drip"],
  },
  {
    slug: "cost-basis",
    term: "Cost basis",
    category: "Investing",
    short:
      "Cost basis is the original value of an asset for tax purposes — normally what was paid, adjusted for events such as splits, returns of capital and reinvested dividends. Gain or loss on disposal is the proceeds minus the basis.",
    body: [
      "Where the same security has been bought at several prices, which lot is considered sold determines the taxable result. Methods such as first-in-first-out or specific identification produce different outcomes from identical trades, and the method must be applied consistently rather than chosen afterwards.",
      "This is the reason a double-entry lot ledger is worth the complexity: an aggregate average price cannot answer which lot was sold, so it cannot produce a defensible figure once a position has been built over time.",
    ],
    see: ["fractional-shares", "drip"],
  },
  {
    slug: "drip",
    term: "DRIP",
    expansion: "Dividend reinvestment plan",
    category: "Investing",
    short:
      "A dividend reinvestment plan automatically uses cash dividends to buy more of the same security instead of paying cash. Each reinvestment creates a new tax lot at the price on that date.",
    body: [
      "Reinvested dividends are generally taxable in the year received even though no cash was taken, and they raise the total cost basis of the holding. Failing to record them is a common and expensive error: it inflates the eventual reported gain, taxing the same money twice.",
      "Where withholding applies to a cross-border dividend, the reinvested amount is the net figure, and the withheld portion has to be tracked separately for any relief claim.",
    ],
    see: ["cost-basis", "fractional-shares"],
  },
  {
    slug: "form-13f",
    term: "Form 13F",
    category: "Investing",
    short:
      "Form 13F is a quarterly SEC filing required of institutional investment managers exercising discretion over at least $100 million in qualifying US-listed securities. It discloses long positions as of quarter end and is filed within 45 days after.",
    body: [
      "A 13F is narrower than it is usually described. It covers long positions in qualifying securities only: short positions, cash, most debt and non-US listings do not appear. For a large bank, much of what does appear is market-making and client facilitation inventory rather than a house view.",
      "Two mechanical details cause most misreadings. The filing is a snapshot up to 45 days stale on publication. And each row carries a put/call field — option rows are reported at the notional value of the underlying, not the premium paid, so counting contracts as shares invents positions that do not exist.",
    ],
    see: ["fractional-shares"],
  },
];

export const TERM_CATEGORIES: TermCategory[] = [
  "Stablecoins",
  "Payments",
  "Investing",
  "Agentic AI",
  "Compliance",
  "Security",
];

const bySlug = new Map(TERMS.map((t) => [t.slug, t]));

export function getTerm(slug: string): Term | undefined {
  return bySlug.get(slug);
}

/** Terms in a category, alphabetical. */
export function termsInCategory(c: TermCategory): Term[] {
  return TERMS.filter((t) => t.category === c).sort((a, b) => a.term.localeCompare(b.term));
}

/** Resolve a `see` list to real terms, dropping any dangling slug. */
export function relatedTerms(t: Term): Term[] {
  return (t.see ?? []).map((s) => bySlug.get(s)).filter((x): x is Term => !!x);
}
