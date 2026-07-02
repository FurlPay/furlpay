import Link from "next/link";
import { DocTitle, Lead, H2, H3, P, UL, LI, Code, Callout } from "@/components/docs/prose";

export const metadata = {
  title: "Responsible Disclosure — Furlpay Legal",
  description:
    "Furlpay's responsible disclosure and bug bounty policy — scope, reporting process, PGP key, response SLA, rewards, and safe harbor.",
};

export default function ResponsibleDisclosurePage() {
  return (
    <article>
      <DocTitle eyebrow="Legal">Responsible Disclosure &amp; Bug Bounty</DocTitle>
      <p className="mb-6 text-[13px] text-textMuted">Last updated: July 2, 2026</p>
      <Lead>
        Furlpay takes the security of our platform, our users&rsquo; funds, and their personal
        data seriously. We welcome responsible security research and will not pursue legal action
        against researchers who follow this policy in good faith.
      </Lead>

      <H2 id="scope">1. Scope</H2>
      <P>The following assets and services are in scope for responsible disclosure:</P>
      <UL>
        <LI>
          <strong>Web application:</strong> <Code>furlpay.com</Code> and all subdomains (e.g.,{" "}
          <Code>app.furlpay.com</Code>, <Code>api.furlpay.com</Code>).
        </LI>
        <LI>
          <strong>REST &amp; GraphQL APIs:</strong> All versioned API endpoints under{" "}
          <Code>/api/v*</Code>, including the x402 agent payment protocol.
        </LI>
        <LI>
          <strong>SDKs:</strong> The official Furlpay JavaScript/TypeScript SDK (
          <Code>@furlpay/sdk</Code>) and the x402 agent SDK (<Code>@furlpay/x402</Code>).
        </LI>
        <LI>
          <strong>Mobile applications:</strong> Furlpay iOS and Android apps distributed through
          official app stores.
        </LI>
        <LI>
          <strong>Smart contracts:</strong> Any Furlpay-deployed contracts on Base, Solana,
          Arbitrum, or Ethereum mainnet.
        </LI>
      </UL>

      <H3 id="out-of-scope">Out of scope</H3>
      <UL>
        <LI>Third-party services (Stripe, Marqeta, Persona, etc.) — report issues directly to those vendors.</LI>
        <LI>Social engineering or phishing attacks against Furlpay employees or users.</LI>
        <LI>Denial-of-service (DoS/DDoS) attacks.</LI>
        <LI>Physical attacks against Furlpay offices or data centers.</LI>
        <LI>Vulnerabilities in third-party libraries unless they are exploitable within the Furlpay context.</LI>
        <LI>Automated scanning output without a demonstrated proof-of-concept.</LI>
      </UL>

      <H2 id="reporting">2. Reporting process</H2>
      <P>
        If you believe you have found a security vulnerability, please report it responsibly:
      </P>
      <UL>
        <LI>
          <strong>Email:</strong>{" "}
          <a href="mailto:security@furlpay.com" className="text-neon hover:underline">
            security@furlpay.com
          </a>
        </LI>
        <LI>
          <strong>Encryption:</strong> We strongly encourage encrypting your report using our PGP
          key (see below). Use the subject line{" "}
          <Code>[SECURITY] Brief description</Code>.
        </LI>
        <LI>
          <strong>Required information:</strong> Description of the vulnerability, affected
          asset(s), step-by-step reproduction instructions, proof-of-concept (screenshots, video,
          or code), and an assessment of the impact.
        </LI>
        <LI>
          <strong>Optional:</strong> Suggested remediation, CVSS score estimate, and your
          preferred contact method for follow-up.
        </LI>
      </UL>

      <H2 id="pgp-key">3. PGP public key</H2>
      <P>
        Encrypt sensitive vulnerability reports using the following PGP key. The full public key
        block is also available at{" "}
        <Code>https://furlpay.com/.well-known/security.txt</Code>.
      </P>
      <div className="mb-6 overflow-hidden rounded-xl border border-white/10 bg-[#0A0A0C]">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-textSecondary">
            PGP Fingerprint
          </span>
        </div>
        <pre className="overflow-x-auto px-4 py-4 text-[13px] leading-relaxed">
          <code className="font-mono text-white/90">
            Key ID: 0xA1B2C3D4E5F60789{"\n"}
            Fingerprint: 4A1B 2C3D 4E5F 6078 9ABC DEF0 1234 5678 9ABC DEF0{"\n"}
            Algo: RSA 4096-bit / ed25519{"\n"}
            Expires: 2028-01-01
          </code>
        </pre>
      </div>

      <H2 id="response-sla">4. Response SLA</H2>
      <P>We commit to the following response timelines for all reports submitted in good faith:</P>
      <div className="mb-6 overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-white/[0.03] text-textSecondary">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Milestone</th>
              <th className="px-4 py-2.5 font-semibold">SLA</th>
            </tr>
          </thead>
          <tbody className="text-textMuted">
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5">Acknowledgment of receipt</td>
              <td className="px-4 py-2.5 font-mono text-neon">≤ 48 hours</td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5">Initial triage &amp; severity assessment</td>
              <td className="px-4 py-2.5 font-mono text-neon">≤ 7 days</td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5">Status update (if still under investigation)</td>
              <td className="px-4 py-2.5 font-mono text-neon">Every 14 days</td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5">Fix deployment (critical / high severity)</td>
              <td className="px-4 py-2.5 font-mono text-neon">≤ 30 days</td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5">Fix deployment (medium / low severity)</td>
              <td className="px-4 py-2.5 font-mono text-neon">≤ 90 days</td>
            </tr>
          </tbody>
        </table>
      </div>

      <H2 id="rewards">5. Rewards</H2>
      <P>
        Furlpay offers monetary rewards for qualifying vulnerability reports. Reward amounts are
        determined by the severity of the vulnerability, the quality of the report, and the
        potential impact on user funds or data.
      </P>
      <div className="mb-6 overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-white/[0.03] text-textSecondary">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Severity</th>
              <th className="px-4 py-2.5 font-semibold">CVSS Range</th>
              <th className="px-4 py-2.5 font-semibold">Reward (USD)</th>
            </tr>
          </thead>
          <tbody className="text-textMuted">
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-red-500/25 bg-red-500/10 px-2 py-0.5 text-[11px] font-bold text-red-400">
                  Critical
                </span>
              </td>
              <td className="px-4 py-2.5 font-mono">9.0 – 10.0</td>
              <td className="px-4 py-2.5 font-mono text-neon">$5,000 – $25,000</td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-orange-500/25 bg-orange-500/10 px-2 py-0.5 text-[11px] font-bold text-orange-400">
                  High
                </span>
              </td>
              <td className="px-4 py-2.5 font-mono">7.0 – 8.9</td>
              <td className="px-4 py-2.5 font-mono text-neon">$2,000 – $5,000</td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-yellow-500/25 bg-yellow-500/10 px-2 py-0.5 text-[11px] font-bold text-yellow-400">
                  Medium
                </span>
              </td>
              <td className="px-4 py-2.5 font-mono">4.0 – 6.9</td>
              <td className="px-4 py-2.5 font-mono text-neon">$500 – $2,000</td>
            </tr>
            <tr className="border-t border-white/5">
              <td className="px-4 py-2.5">
                <span className="rounded-md border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[11px] font-bold text-blue-400">
                  Low
                </span>
              </td>
              <td className="px-4 py-2.5 font-mono">0.1 – 3.9</td>
              <td className="px-4 py-2.5 font-mono text-neon">$100 – $500</td>
            </tr>
          </tbody>
        </table>
      </div>
      <P>
        Rewards are paid in USDC to your Furlpay wallet, or via bank transfer upon request.
        Duplicate reports receive credit but no monetary reward. The first reporter of a given
        vulnerability receives the full reward.
      </P>

      <H2 id="safe-harbor">6. Safe harbor</H2>
      <Callout title="Legal safe harbor">
        Furlpay will not initiate legal proceedings against security researchers who comply with this
        policy. Specifically, we will not pursue civil or criminal action, or support prosecution by
        law enforcement, for security research conducted in good faith under these guidelines.
      </Callout>
      <P>To qualify for safe harbor, you must:</P>
      <UL>
        <LI>Act in good faith and avoid privacy violations, data destruction, and service disruption.</LI>
        <LI>Not access, modify, or delete data belonging to other users.</LI>
        <LI>Stop testing and report the issue promptly once a vulnerability is confirmed.</LI>
        <LI>Not publicly disclose the vulnerability before Furlpay has had a reasonable opportunity to remediate it (minimum 90 days or until fix is deployed, whichever comes first).</LI>
        <LI>Test only against accounts you own or have explicit authorization to test.</LI>
        <LI>Not use automated tools at a volume that degrades service for other users.</LI>
      </UL>

      <H2 id="exclusions">7. Exclusions</H2>
      <P>The following issue types are generally not eligible for rewards:</P>
      <UL>
        <LI>Missing security headers that do not lead to a demonstrated exploit.</LI>
        <LI>Clickjacking on pages with no sensitive actions.</LI>
        <LI>Self-XSS (cross-site scripting that only affects the researcher&rsquo;s own session).</LI>
        <LI>CSRF on logout or other low-impact state changes.</LI>
        <LI>Email enumeration via login, registration, or password-reset endpoints.</LI>
        <LI>Content spoofing or text injection without a demonstrated impact.</LI>
        <LI>Rate-limiting or brute-force issues on non-authentication endpoints.</LI>
        <LI>Vulnerabilities requiring physical access to the user&rsquo;s device.</LI>
        <LI>Theoretical attacks without a working proof-of-concept.</LI>
      </UL>

      <H2 id="recognition">8. Hall of Fame</H2>
      <P>
        With your permission, we will publicly acknowledge your contribution on our Security
        Researchers Hall of Fame page. Researchers may opt out of public recognition if preferred.
      </P>

      <div className="mt-12 border-t border-white/5 pt-6 text-[13px] text-textMuted">
        See also{" "}
        <Link href="/legal/privacy" className="text-neon hover:underline">Privacy Policy</Link>,{" "}
        <Link href="/legal/terms" className="text-neon hover:underline">Terms of Service</Link>, and{" "}
        <Link href="/legal/acceptable-use" className="text-neon hover:underline">Acceptable Use Policy</Link>.
      </div>
    </article>
  );
}
