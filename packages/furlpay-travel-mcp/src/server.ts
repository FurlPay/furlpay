#!/usr/bin/env node
/**
 * FurlPay Travels MCP server (stdio transport, JSON-RPC 2.0).
 *
 * Composes Travala's Travel MCP (search) with FurlPay's payment rails (pay) and
 * exposes them as MCP tools for Claude, Cursor, and AI agents. Runs on demo data
 * with no keys.
 *
 * Configure in an MCP client:
 *   {
 *     "mcpServers": {
 *       "furlpay-travels": {
 *         "command": "npx", "args": ["-y", "@furlpay/travel-mcp"],
 *         "env": { "FURLPAY_API_KEY": "fp_live_sk_...", "TRAVALA_API_KEY": "..." }
 *       }
 *     }
 *   }
 */
import { buildTools } from "./tools";
import { TravelClient } from "./travel";

const client = new TravelClient();
const tools = buildTools(client);

function send(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(line: string): Promise<void> {
  let req: any;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = req;
  try {
    if (method === "initialize") {
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "furlpay-travels", version: "0.1.0" },
        },
      });
    }
    if (method === "tools/list") {
      return send({
        jsonrpc: "2.0",
        id,
        result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
      });
    }
    if (method === "tools/call") {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) throw new Error(`Unknown tool: ${params?.name}`);
      const result = await tool.handler(params.arguments || {});
      return send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    }
    if (typeof method === "string" && method.startsWith("notifications/")) return;
    throw new Error(`Method not found: ${method}`);
  } catch (e) {
    send({ jsonrpc: "2.0", id, error: { code: -32000, message: (e as Error).message } });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx: number;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) void handle(line);
  }
});

process.stderr.write(`furlpay-travels MCP ready (${client.live ? "live" : "demo"} mode)\n`);
