import Link from "next/link";
import Reveal from "./Reveal";
import AvatarStrip from "./AvatarStrip";
import { GitHubIcon } from "@/components/marketing/SocialIcons";

/*
 * Proof — without a single invented testimonial.
 *
 * There are no verified customer quotes, logos, download counts or transaction
 * volumes for FurlPay, so none appear. What exists and can be checked: four
 * first-party SDKs in sdks/, framework adapters in packages/, an MCP server,
 * and a public repository. That is infrastructure proof, and it is the kind a
 * developer audience actually verifies.
 */

const SDKS = [
  { lang: "TypeScript", pkg: "@furlpay/furlpay-node" },
  { lang: "Python", pkg: "furlpay" },
  { lang: "Go", pkg: "github.com/furlpay/furlpay-go" },
  { lang: "Rust", pkg: "furlpay" },
];

const ADAPTERS = [
  "LangChain",
  "LlamaIndex",
  "CrewAI",
  "PydanticAI",
  "OpenAI Agents",
  "Vercel AI SDK",
  "Mastra",
  "MCP",
];

export default function ProofSection() {
  return (
    <section className="section section-y" id="proof" aria-labelledby="proof-title">
      <Reveal>
        <p className="section-eyebrow">Proof</p>
        <h2 className="section-title mt-3 max-w-3xl" id="proof-title">
          Built by developers. Built for production.
        </h2>
        <p className="section-lede mt-4">
          No testimonials on this page — there are none to quote yet. Instead, the things you can
          clone, install and read.
        </p>
      </Reveal>

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        <Reveal className="lg:col-span-2">
          <div className="surface h-full p-7">
            <p className="text-[15px] font-bold">First-party SDKs</p>
            <p className="mt-2 text-[13px] text-textSecondary">
              One client per language, generated against the same REST surface.
            </p>
            <ul className="mt-5 grid gap-2 sm:grid-cols-2">
              {SDKS.map((sdk) => (
                <li
                  key={sdk.lang}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3"
                >
                  <span className="text-[14px] font-semibold text-white">{sdk.lang}</span>
                  <code className="truncate font-mono text-[11.5px] text-textMuted">{sdk.pkg}</code>
                </li>
              ))}
            </ul>

            <p className="mt-7 text-[15px] font-bold">Agent framework adapters</p>
            <p className="mt-2 text-[13px] text-textSecondary">
              Drop-in tools so an agent can pay from inside the framework you already use.
            </p>
            {/* The portrait-row treatment a testimonial wall would use, spent
                on the integrations that exist rather than on faces that do
                not. Same visual weight, nothing invented. */}
            <AvatarStrip
              className="mt-5"
              items={ADAPTERS.map((name) => ({ name }))}
              caption="Eight framework adapters, each a published package rather than a logo on a page."
            />
          </div>
        </Reveal>

        <Reveal delay={80}>
          <div className="surface flex h-full flex-col justify-between p-7">
            <div>
              <GitHubIcon aria-hidden className="h-7 w-7 text-white" />
              <p className="mt-4 text-[15px] font-bold">Read the source</p>
              <p className="mt-2 text-[13px] leading-relaxed text-textSecondary">
                The claims on this page name the file that backs them. The repository is public,
                so you can check any of them without asking us.
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <a
                href="https://github.com/Ashutosh0x/furlpay"
                className="btn-outline px-5 py-2.5 text-center text-[14px]"
                rel="noopener noreferrer"
                target="_blank"
              >
                GitHub repository
              </a>
              <Link href="/changelog" className="text-center text-[13px] text-textSecondary transition-colors hover:text-white">
                What shipped recently →
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
