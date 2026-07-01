import { DocTitle, Lead, H2, P, UL, LI, Code, CodeBlock, DocPager } from "@/components/docs/prose";

export const metadata = { title: "Furlpay Docs — Monorepo" };

export default function MonorepoPage() {
  return (
    <article>
      <DocTitle eyebrow="Architecture">Monorepo</DocTitle>
      <Lead>
        Furlpay is a Turborepo monorepo. Shared domain logic lives in <Code>packages/</Code>, product
        surfaces in <Code>apps/</Code>, published clients in <Code>sdks/</Code>, and agent tooling in
        <Code>mcp/</Code>.
      </Lead>

      <CodeBlock lang="bash">{`.
├── apps/
│   ├── web         # Next.js app + serverless API routes
│   ├── desktop     # Tauri shell (Windows / macOS / Linux)
│   └── extension   # MV3 browser extension (checkout + autofill)
├── packages/
│   ├── ledger      # double-entry ledger
│   ├── security    # MPC, WebAuthn, risk engine
│   ├── compliance  # KYC tiers, jurisdiction resolver, travel rule
│   ├── account-kit # wallet + account primitives
│   ├── types       # shared zod schemas & TS types
│   └── ui          # design system, icons, brand assets
├── sdks/           # @furlpay/node, @furlpay/react, @furlpay/cli
├── mcp/            # Model Context Protocol server
├── turbo.json      # pipeline: build, lint, typecheck, dev
└── package.json    # npm workspaces`}</CodeBlock>

      <H2 id="turbo">Build pipeline (<Code>turbo.json</Code>)</H2>
      <P>
        Turbo orchestrates and caches tasks across workspaces. Packages build before the apps that depend
        on them; <Code>dev</Code> is long-running and uncached.
      </P>
      <CodeBlock lang="bash">{`turbo run build      # topological, cached
turbo run typecheck  # tsc --noEmit across all workspaces
turbo run dev        # web + desktop + extension in parallel`}</CodeBlock>

      <H2 id="desktop">Desktop wrappers (Tauri)</H2>
      <P>
        <Code>apps/desktop</Code> wraps the web client in a Tauri shell and ships native installers. One
        Rust core, three artifacts:
      </P>
      <UL>
        <LI><b>Windows</b> — <Code>.msi</Code></LI>
        <LI><b>macOS</b> — <Code>.dmg</Code></LI>
        <LI><b>Linux</b> — <Code>.deb</Code></LI>
      </UL>

      <H2 id="extension">Browser extension</H2>
      <P>
        <Code>apps/extension</Code> is a Manifest V3 extension providing one-click stablecoin checkout and
        secure autofill. It talks to the same API routes as web and desktop, and shares the{" "}
        <Code>next.config.js</Code>-driven build conventions where relevant.
      </P>

      <H2 id="assets">Visual assets &amp; iconography</H2>
      <UL>
        <LI>Token &amp; brand logos are sourced from <Code>CryptoLogos.cc</Code> and vendored in <Code>packages/ui</Code>.</LI>
        <LI><Code>Lucide React</Code> provides the icon set shared across web, desktop and extension.</LI>
      </UL>

      <DocPager pathname="/docs/architecture/monorepo" />
    </article>
  );
}
