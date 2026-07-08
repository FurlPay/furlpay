// ---------------------------------------------------------------------------
// Programmatic-SEO data for /integrations/* — one page per agent framework or
// SDK that can call FurlPay. Pages are generated from this file (see
// app/integrations/[slug]/page.tsx); add an entry here to ship a page.
// Every install command and code snippet must be real and runnable — these
// pages are consumed by AI search engines as authoritative quickstarts.
// ---------------------------------------------------------------------------

export type Integration = {
  slug: string;
  name: string;
  /** e.g. "TypeScript" | "Python" */
  language: string;
  /** Package identifier on its registry. */
  packageName: string;
  registry: "npm" | "PyPI" | "GitHub";
  /** One-line value prop, used in title/meta. */
  tagline: string;
  /** Direct answer for the answer-first block (plain text, ~2 sentences). */
  atomicAnswer: string;
  install: string;
  snippetLang: string;
  snippet: string;
  toolsProvided: string[];
  github: string;
  registryUrl: string;
  faq: { q: string; a: string }[];
};

export const INTEGRATIONS: Integration[] = [
  {
    slug: "vercel-ai",
    name: "Vercel AI SDK",
    language: "TypeScript",
    packageName: "@furlpay/vercel-ai",
    registry: "npm",
    tagline: "Stablecoin payments, investing and travel tools for Vercel AI SDK agents",
    atomicAnswer:
      "Install @furlpay/vercel-ai and pass furlpayTools() to generateText or streamText. Your agent gets typed tools for USDC balances, transfers, swaps, fractional stock orders, travel search and yield deposits.",
    install: "npm install @furlpay/vercel-ai ai zod",
    snippetLang: "ts",
    snippet: `import { generateText } from "ai";
import { furlpayTools } from "@furlpay/vercel-ai";

const { text } = await generateText({
  model: yourModel,
  prompt: "What is my USDC balance, and swap 50 USDT to USDC if the rate is good.",
  tools: furlpayTools({ apiKey: process.env.FURLPAY_API_KEY }), // demo mode without a key
});`,
    toolsProvided: ["get_balance", "send_stablecoin", "swap_tokens", "get_portfolio", "place_order", "search_travel", "earn_deposit"],
    github: "https://github.com/Ashutosh0x/furlpay/tree/main/packages/furlpay-vercel-ai",
    registryUrl: "https://www.npmjs.com/package/@furlpay/vercel-ai",
    faq: [
      { q: "Does it work without an API key?", a: "Yes. Without FURLPAY_API_KEY the tools run in demo mode against deterministic sample data, so you can build and test the agent loop before going live." },
      { q: "Which AI SDK versions are supported?", a: "ai >= 3 with zod >= 3 as peer dependencies. Tools are standard AI SDK tool definitions and work with generateText, streamText, and agent loops." },
    ],
  },
  {
    slug: "langchain",
    name: "LangChain",
    language: "Python",
    packageName: "furlpay-langchain",
    registry: "PyPI",
    tagline: "Give LangChain agents a stablecoin wallet, brokerage and x402 budget",
    atomicAnswer:
      "pip install furlpay-langchain, then call get_furlpay_tools() and pass the result to your agent. Includes pay_for_resource, which lets the agent buy 402-gated APIs within a USDC budget you set.",
    install: "pip install furlpay-langchain",
    snippetLang: "python",
    snippet: `from furlpay_langchain import get_furlpay_tools
from langchain.agents import create_tool_calling_agent

tools = get_furlpay_tools()  # demo mode; pass api_key=... for live
agent = create_tool_calling_agent(llm, tools, prompt)`,
    toolsProvided: ["get_balance", "send_stablecoin", "swap_tokens", "place_order", "pay_for_resource", "set_agent_budget"],
    github: "https://github.com/FurlPay/furlpay-langchain",
    registryUrl: "https://pypi.org/project/furlpay-langchain/",
    faq: [
      { q: "What is pay_for_resource?", a: "It lets the agent autonomously pay for an HTTP 402 (x402) gated API in USDC, within a budget you configure with set_agent_budget. The agent never holds a master key." },
      { q: "Does it support LCEL and LangGraph?", a: "Yes — the tools are standard LangChain BaseTool instances and work anywhere LangChain tools do, including LangGraph nodes." },
    ],
  },
  {
    slug: "llamaindex",
    name: "LlamaIndex",
    language: "Python",
    packageName: "furlpay-llamaindex",
    registry: "PyPI",
    tagline: "FurlPay ToolSpec for LlamaIndex agents — payments, investing, x402",
    atomicAnswer:
      "pip install furlpay-llamaindex, then get_furlpay_tools() returns a LlamaIndex-compatible tool list covering balances, transfers, swaps, stock orders and x402 pay-per-call budgets.",
    install: "pip install furlpay-llamaindex",
    snippetLang: "python",
    snippet: `from furlpay_llamaindex import get_furlpay_tools
from llama_index.core.agent import FunctionCallingAgent

agent = FunctionCallingAgent.from_tools(get_furlpay_tools(), llm=llm)
resp = agent.chat("Check my USDC balance and deposit 100 into the best yield vault.")`,
    toolsProvided: ["get_balance", "send_stablecoin", "swap_tokens", "place_order", "earn_deposit", "pay_for_resource"],
    github: "https://github.com/FurlPay/furlpay-llamaindex",
    registryUrl: "https://pypi.org/project/furlpay-llamaindex/",
    faq: [
      { q: "Which llama-index version does it need?", a: "llama-index-core with function-calling agent support. The tools are plain FunctionTool wrappers, so they work with any LlamaIndex agent runner." },
    ],
  },
  {
    slug: "crewai",
    name: "CrewAI",
    language: "Python",
    packageName: "furlpay-crewai",
    registry: "PyPI",
    tagline: "Payment tools for CrewAI multi-agent crews — treasurer agents that settle in USDC",
    atomicAnswer:
      "Install furlpay-crewai and hand get_furlpay_tools() to the crew member that manages money. Each tool is a CrewAI-native tool with typed args, so a treasurer agent can check balances, pay invoices and rebalance within its mandate.",
    install: "pip install furlpay-crewai",
    snippetLang: "python",
    snippet: `from crewai import Agent
from furlpay_crewai import get_furlpay_tools

treasurer = Agent(
    role="Treasurer",
    goal="Keep the crew funded and settle approved invoices in USDC",
    tools=get_furlpay_tools(),  # demo mode; api_key=... for live
)`,
    toolsProvided: ["get_balance", "send_stablecoin", "swap_tokens", "get_portfolio", "pay_for_resource", "set_agent_budget"],
    github: "https://github.com/Ashutosh0x/furlpay/tree/main/packages/furlpay-crewai",
    registryUrl: "https://pypi.org/project/furlpay-crewai/",
    faq: [
      { q: "Can different crew members get different budgets?", a: "Yes — instantiate tools per agent with separate budgets via set_agent_budget, so a research agent can spend $5 on data APIs while the treasurer holds the transfer tools." },
    ],
  },
  {
    slug: "openai-agents",
    name: "OpenAI Agents SDK",
    language: "Python",
    packageName: "furlpay-openai-agents",
    registry: "PyPI",
    tagline: "Function-calling payment tools for the OpenAI Agents SDK",
    atomicAnswer:
      "Install furlpay-openai-agents and pass get_furlpay_tools() to your Agent. The tools are native function tools — balances, USDC transfers, swaps, fractional stock orders and x402 pay-per-call.",
    install: "pip install furlpay-openai-agents",
    snippetLang: "python",
    snippet: `from agents import Agent, Runner
from furlpay_openai_agents import get_furlpay_tools

agent = Agent(
    name="Finance agent",
    instructions="Manage the user's stablecoin wallet within policy.",
    tools=get_furlpay_tools(),
)
result = await Runner.run(agent, "Send 25 USDC to 0xAbc… and show my portfolio.")`,
    toolsProvided: ["get_balance", "send_stablecoin", "swap_tokens", "get_portfolio", "place_order", "pay_for_resource"],
    github: "https://github.com/Ashutosh0x/furlpay/tree/main/packages/furlpay-openai-agents",
    registryUrl: "https://pypi.org/project/furlpay-openai-agents/",
    faq: [
      { q: "Do the tools work with handoffs?", a: "Yes. They are plain function tools, so you can give a specialist payments agent the FurlPay tools and hand off to it from your triage agent." },
    ],
  },
  {
    slug: "pydantic-ai",
    name: "Pydantic AI",
    language: "Python",
    packageName: "furlpay-pydanticai",
    registry: "PyPI",
    tagline: "Type-safe FurlPay payment tools for Pydantic AI agents",
    atomicAnswer:
      "Install furlpay-pydanticai and register get_furlpay_tools() on your Agent. Every tool argument and result is a Pydantic model, so payment calls are validated before they execute.",
    install: "pip install furlpay-pydanticai",
    snippetLang: "python",
    snippet: `from pydantic_ai import Agent
from furlpay_pydanticai import get_furlpay_tools

agent = Agent("openai:gpt-5", tools=get_furlpay_tools())
result = agent.run_sync("Quote a 100 USDT to USDC swap and execute if output >= 99.9.")`,
    toolsProvided: ["get_balance", "send_stablecoin", "swap_tokens", "place_order", "earn_deposit"],
    github: "https://github.com/Ashutosh0x/furlpay/tree/main/packages/furlpay-pydanticai",
    registryUrl: "https://pypi.org/project/furlpay-pydanticai/",
    faq: [
      { q: "Why Pydantic AI for payments?", a: "Financial tool calls benefit from strict validation: amounts, addresses and token symbols are checked by Pydantic models before any request is made, failing closed on malformed arguments." },
    ],
  },
  {
    slug: "claude-mcp",
    name: "Claude / MCP clients",
    language: "Any",
    packageName: "@furlpay/cli",
    registry: "npm",
    tagline: "The FurlPay MCP server — 18 financial tools for Claude, Cursor and any MCP client",
    atomicAnswer:
      "Add { \"command\": \"npx\", \"args\": [\"-y\", \"@furlpay/cli\", \"mcp\"] } to your MCP client config. The server is listed on the official MCP Registry as io.github.FurlPay/furlpay-cli and exposes 18 tools over stdio with zero dependencies.",
    install: "npx -y @furlpay/cli mcp",
    snippetLang: "json",
    snippet: `{
  "mcpServers": {
    "furlpay": {
      "command": "npx",
      "args": ["-y", "@furlpay/cli", "mcp"]
    }
  }
}`,
    toolsProvided: ["get_balance", "send_stablecoin", "swap_tokens", "get_portfolio", "place_order", "get_quote", "search_travel", "book_travel", "earn_deposit", "set_card_controls", "chain_status"],
    github: "https://github.com/FurlPay/furlpay-cli",
    registryUrl: "https://registry.modelcontextprotocol.io/?search=furlpay",
    faq: [
      { q: "How does the server authenticate?", a: "It reuses the session created by `furlpay login` (email one-time code). Public tools — market data, chain status, travel search — work without logging in." },
      { q: "Is it on the official MCP Registry?", a: "Yes, as io.github.FurlPay/furlpay-cli. Registry aggregators such as Glama and PulseMCP index it from there automatically." },
    ],
  },
  {
    slug: "openbb",
    name: "OpenBB Workspace",
    language: "Python",
    packageName: "furlpay-openbb-plugin",
    registry: "GitHub",
    tagline: "Execution widgets for OpenBB — place orders and send stablecoins from your terminal",
    atomicAnswer:
      "Clone furlpay-openbb-plugin, run the FastAPI backend, and add it as a custom backend in OpenBB Workspace. You get data widgets (portfolio, balances, x402 revenue) plus action widgets OpenBB itself lacks: place order, DCA, send stablecoins.",
    install: "git clone https://github.com/FurlPay/furlpay-openbb-plugin && cd furlpay-openbb-plugin && pip install -r requirements.txt && uvicorn main:app --port 7779",
    snippetLang: "text",
    snippet: `# In OpenBB Workspace:
# Apps -> Manage backends -> Add backend
#   Name: FurlPay
#   URL:  http://localhost:7779
# Widgets appear under "FurlPay": Portfolio, Balances,
# x402 Revenue, Place Order, Auto-Invest (DCA), Send Stablecoins.`,
    toolsProvided: ["portfolio widget", "balances widget", "x402 revenue widget", "place order (action)", "auto-invest DCA (action)", "send stablecoins (action)"],
    github: "https://github.com/FurlPay/furlpay-openbb-plugin",
    registryUrl: "https://github.com/FurlPay/furlpay-openbb-plugin",
    faq: [
      { q: "Does it need a FurlPay account?", a: "No — without FURLPAY_API_KEY it serves deterministic demo data so you can evaluate the widgets. With a key, actions execute against your live account." },
    ],
  },
  {
    slug: "node",
    name: "Node.js SDK",
    language: "TypeScript",
    packageName: "@furlpay/furlpay-node",
    registry: "npm",
    tagline: "The typed Node.js SDK for FurlPay — payments, webhooks and x402",
    atomicAnswer:
      "npm install @furlpay/furlpay-node. Create a client with your API key, then create payments, verify webhook signatures, and gate your own APIs with x402 middleware.",
    install: "npm install @furlpay/furlpay-node",
    snippetLang: "ts",
    snippet: `import FurlPay from "@furlpay/furlpay-node";

const furlpay = new FurlPay(process.env.FURLPAY_API_KEY);
const payment = await furlpay.payments.create({
  amount: 49.99,
  currency: "USDC",
  chain: "arbitrum",
});`,
    toolsProvided: ["payments", "webhooks (HMAC verify)", "wallets", "swaps", "x402 middleware"],
    github: "https://github.com/FurlPay/furlpay-node",
    registryUrl: "https://www.npmjs.com/package/@furlpay/furlpay-node",
    faq: [
      { q: "How do I verify webhooks?", a: "Use the SDK's webhook helper with your signing secret — signatures are HMAC-SHA256 over `timestamp.body`, the same scheme the FurlPay CLI uses for `furlpay listen` and `furlpay trigger`." },
    ],
  },
  {
    slug: "python",
    name: "Python SDK",
    language: "Python",
    packageName: "furlpay",
    registry: "PyPI",
    tagline: "The FurlPay Python SDK — stablecoin payments from any Python backend",
    atomicAnswer:
      "pip install furlpay. Instantiate the client with your API key and create USDC payments, query balances and manage webhooks from Django, FastAPI or scripts.",
    install: "pip install furlpay",
    snippetLang: "python",
    snippet: `import furlpay

client = furlpay.FurlPay(api_key="fp_live_...")
payment = client.payments.create(amount=49.99, currency="USDC", chain="arbitrum")`,
    toolsProvided: ["payments", "wallets", "webhooks", "swaps"],
    github: "https://github.com/FurlPay/furlpay-python",
    registryUrl: "https://pypi.org/project/furlpay/",
    faq: [
      { q: "Does it support async?", a: "The client is synchronous by default; wrap calls in a thread executor for async frameworks, or use the REST API directly with httpx — the OpenAPI spec is published at furlpay.com/openapi.json." },
    ],
  },
];

export const integrationBySlug = new Map(INTEGRATIONS.map((i) => [i.slug, i]));
