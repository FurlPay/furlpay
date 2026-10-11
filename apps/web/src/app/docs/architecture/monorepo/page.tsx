import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, SpecGrid, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/architecture/monorepo");

export default function MonorepoPage() {
  return (
    <article>
      <DocTitle eyebrow="Architecture">Monorepo</DocTitle>
      <Lead>
        FurlPay uses an npm-workspace Turborepo. The repository contains the web app and API,
        developer SDKs, agent integrations, shared packages and client application source.
        Code in the repository does not by itself indicate a released or production-enabled service.
      </Lead>

      <Callout type="warning" title="Repository presence is not product availability">
        Some packages and route handlers are prototypes, test integrations or gated capabilities.
        Use the <a href="/docs" className="text-neon hover:underline">service availability overview</a>{" "}
        and the current rail status before relying on a feature in production.
      </Callout>

      <H2 id="surfaces">Main workspaces</H2>
      <SpecGrid
        specs={[
          {
            name: "apps/web",
            badge: "Next.js 15",
            desc: "Web product, documentation portal and App Router API handlers.",
          },
          {
            name: "sdks/node",
            badge: "@furlpay/furlpay-node",
            desc: "Node.js / TypeScript server SDK and webhook-signature helper.",
          },
          {
            name: "packages/cli",
            badge: "@furlpay/cli",
            desc: "Command-line developer tooling. Commands that call payment, travel, card or brokerage routes inherit those routes' availability limits.",
          },
          {
            name: "packages/gateway",
            badge: "@furlpay/gateway",
            desc: "Self-hosted x402 gateway package. Its default FurlPay facilitator requires production settlement to be enabled.",
          },
          {
            name: "mcp",
            badge: "@furlpay/mcp-server",
            desc: "MCP integration for compatible agent clients; available tools and payment execution are separate concerns.",
          },
          {
            name: "packages/",
            badge: "Shared modules",
            desc: "Shared code for schemas, ledger, signing, compliance, settlement and UI components.",
          },
        ]}
      />

      <H2 id="dependencies">Dependency direction</H2>
      <P>
        Apps and SDKs can depend on shared packages. Shared packages should not depend on a
        product surface. This keeps reusable schemas and domain logic separate from Next.js route
        handlers and client applications.
      </P>
      <UL>
        <LI>API and product routes live in <Code>apps/web/src/app</Code>.</LI>
        <LI>Shared payment, security and provider code lives under <Code>apps/web/src/lib</Code> and <Code>packages/</Code>.</LI>
        <LI>Server SDK sources live under <Code>sdks/</Code>; the CLI and x402 gateway are separate packages.</LI>
        <LI>Application and package release status is maintained separately from source code.</LI>
      </UL>

      <H2 id="contracts">Build and deployable artifacts</H2>
      <P>
        Workspace build scripts are orchestrated through Turborepo and npm. Deployment targets,
        external credentials, release signing and store publication are configured separately.
        A successful local build does not prove that a provider is configured or that an artifact
        is published.
      </P>

      <H2 id="open-source">Source and documentation</H2>
      <P>
        The public packages and repositories are linked from the{" "}
        <a href="https://github.com/FurlPay" className="text-neon hover:underline">FurlPay GitHub organization</a>.
        Use each package&apos;s own README and release metadata for installation details. This
        portal is the source for current FurlPay API and service availability guidance.
      </P>

      <DocPager pathname="/docs/architecture/monorepo" />
    </article>
  );
}
