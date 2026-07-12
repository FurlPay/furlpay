import {
  DocTitle,
  Lead,
  H2,
  H3,
  P,
  UL,
  LI,
  Code,
  CodeBlock,
  Callout,
  DepGraph,
  SpecGrid,
  DocPager,
  Mermaid,
} from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/architecture/monorepo");

export default function MonorepoPage() {
  return (
    <article>
      <DocTitle eyebrow="Architecture">Monorepo</DocTitle>
      <Lead>
        Furlpay is managed as a single, unified codebase with <b>Turborepo</b> and npm workspaces. One
        repository guarantees consistent types across the web app, desktop wrapper, browser extension,
        published SDKs, and the MCP server — every surface builds against the same shared domain logic.
      </Lead>

      <H2 id="graph">Dependency graph</H2>
      <P>
        Compilation boundaries flow in one direction. Product surfaces and distributed clients depend on
        the shared foundation; the foundation depends on nothing above it. This keeps domain rules (ledger
        invariants, compliance routing, crypto schemas) defined exactly once.
      </P>
      <DepGraph
        caption="Everything above depends on the shared foundation below — never the reverse."
        layers={[
          {
            label: "Product surfaces — apps/",
            hint: "user-facing",
            nodes: [
              { name: "web", sub: "Next.js + API" },
              { name: "desktop", sub: "Tauri" },
              { name: "extension", sub: "MV3" },
            ],
          },
          {
            label: "Distribution — sdks/ · mcp/",
            hint: "published clients & agent tooling",
            nodes: [
              { name: "@furlpay/node" },
              { name: "@furlpay/cli" },
              { name: "@furlpay/elements" },
              { name: "mcp-server" },
            ],
          },
          {
            label: "Shared foundation — packages/",
            hint: "single source of truth",
            accent: true,
            nodes: [
              { name: "types" },
              { name: "ledger" },
              { name: "security" },
              { name: "compliance" },
              { name: "account-kit" },
              { name: "ui" },
            ],
          },
        ]}
      />

      <H2 id="containers">Deployable containers</H2>
      <P>
        At runtime the workspaces resolve to a small set of deployable units. Each ships and scales
        independently, but all of them build from the shared foundation above:
      </P>
      <Mermaid
        caption="Container view: what actually runs in production and where state lives."
        chart={`graph LR
    subgraph Runtime[Production runtime]
        WEB[Web app + API - Next.js on Vercel]
        EXTC[Browser extension - Chrome MV3]
        TWA[Android app - TWA]
    end
    subgraph Published[Published artifacts]
        SDK[SDKs - npm and PyPI]
        CLI[CLI + MCP server - npm]
        SC[Contracts - Solidity, Arbitrum and Base]
    end
    subgraph Stores[Managed state]
        PG[(Supabase Postgres - accounts, ops ledger)]
        RD[(Upstash Redis - nonces, sessions, rate limits)]
    end
    EXTC --> WEB
    TWA --> WEB
    SDK --> WEB
    CLI --> WEB
    WEB --> PG
    WEB --> RD
    WEB --> SC`}
      />

      <H2 id="layout">Directory layout</H2>
      <CodeBlock lang="bash">{`.
├── apps/
│   ├── web         # Next.js app + serverless API (auth, x402, Solana Actions)
│   ├── desktop     # Tauri shell (Windows .msi / macOS .dmg / Linux .deb)
│   └── extension   # MV3 browser extension (checkout + autofill)
├── packages/
│   ├── types       # shared zod schemas & TS types (source of truth)
│   ├── ledger      # immutable double-entry ledger
│   ├── security    # 2-of-2 MPC, TOTP MFA, device/behavioural risk
│   ├── compliance  # KYC tiers, jurisdiction resolver, FATF Travel Rule
│   ├── account-kit # Safe / ERC-4337 accounts, paymaster, escrow bindings
│   ├── elements    # embeddable React checkout components
│   ├── cli         # stripe-cli-style developer CLI
│   └── ui          # design system, icons, brand assets
├── sdks/node       # @furlpay/node — official server SDK
├── mcp/            # Model Context Protocol server for AI agents
├── turbo.json      # task pipeline: build, lint, dev
└── package.json    # npm workspaces: apps/* packages/* sdks/node mcp`}</CodeBlock>

      <H2 id="applications">Applications (<Code>apps/</Code>)</H2>
      <SpecGrid
        specs={[
          {
            name: "web",
            badge: "Next.js 14",
            desc: "The primary platform and backend service layer. Serves the responsive dashboard, exposes serverless REST endpoints, handles third-party webhooks (Stripe, Wise, Persona, Marqeta), and hosts the agentic x402 and Solana Actions surfaces.",
          },
          {
            name: "desktop",
            badge: "Tauri (Rust)",
            desc: "A native desktop client that bundles the compiled web assets into a lightweight binary for Windows (.msi), macOS (.dmg), and Linux (.deb) with OS-keychain secure storage.",
          },
          {
            name: "extension",
            badge: "Manifest V3",
            desc: "A browser extension that autofills card credentials and executes checkout directly from the toolbar. Open-sourced so the credential-injection path can be audited.",
          },
        ]}
      />

      <H2 id="packages">Shared packages (<Code>packages/</Code>)</H2>
      <P>
        Shared modules are isolated with strict compilation boundaries so nothing leaks across concerns:
      </P>
      <SpecGrid
        specs={[
          {
            name: "@furlpay/types",
            desc: "Shared TypeScript interfaces and zod schemas — the single source of truth for domain models, imported everywhere.",
          },
          {
            name: "@furlpay/ledger",
            desc: "An immutable, double-entry ledger: balanced postings, derived balances, and reversals used to audit every financial movement.",
          },
          {
            name: "@furlpay/security",
            desc: "The cryptographic layer — 2-of-2 MPC key shares, RFC 6238 TOTP MFA, step-up gating, and device/biometric risk scoring.",
          },
          {
            name: "@furlpay/compliance",
            desc: "The geolocation and routing engine enforcing MiCA/GENIUS stablecoin rules, KYC tiers, and the FATF Travel Rule.",
          },
          {
            name: "@furlpay/account-kit",
            desc: "Wrappers for Safe smart-contract accounts, ERC-4337 bundlers, gas-sponsorship paymasters, and time-locked escrow.",
          },
          {
            name: "@furlpay/ui",
            desc: "The design system — visual tokens, animations, SVG brand assets, and shared primitives.",
          },
        ]}
      />

      <H2 id="turbo">Build pipeline (<Code>turbo.json</Code>)</H2>
      <P>
        Turborepo compiles workspaces in parallel and caches task outputs. The <Code>^build</Code>{" "}
        dependency means a package always builds <i>before</i> the apps that consume it (topological
        order); the <Code>.next/cache</Code> exclusion keeps the framework cache out of the artifact cache;
        <Code>dev</Code> is long-running and never cached.
      </P>
      <CodeBlock lang="json">{`{
  "$schema": "https://turbo.build/schema.json",
  "ui": "stream",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": { "cache": false, "persistent": true },
    "lint": {}
  }
}`}</CodeBlock>
      <CodeBlock lang="bash">{`turbo run build      # topological, content-hashed cache
turbo run lint       # eslint across all workspaces
turbo run dev        # web + desktop + extension in parallel`}</CodeBlock>

      <H3 id="oss">Public surface</H3>
      <P>
        The SDKs, CLI, Elements, Account Kit, MCP server, and extension are mirrored to public repositories
        under <Code>github.com/FurlPay</Code> (MIT). The core application, database schemas, HSM signing
        policy, and fraud models stay private.
      </P>

      <Callout title="Why a monorepo">
        A single repo means one type-check gate covers the API, its SDKs, and its UI at once — a change to a
        zod schema in <Code>@furlpay/types</Code> fails the build everywhere it&apos;s misused, before it can
        ship. That guarantee is what makes shared financial logic safe to refactor.
      </Callout>

      <DocPager pathname="/docs/architecture/monorepo" />
    </article>
  );
}
