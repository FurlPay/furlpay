#!/usr/bin/env node
"use strict";

/**
 * Furlpay MCP server (stdio transport, JSON-RPC 2.0).
 *
 * Exposes Furlpay's Core API as Model Context Protocol tools so AI coding
 * assistants (Claude, Cursor, etc.) can build on Furlpay. Self-contained —
 * no external SDK required.
 *
 * Configure in an MCP client:
 *   { "command": "node", "args": ["mcp/server.js"], "env": { "FURLPAY_BASE_URL": "http://localhost:3000", "FURLPAY_API_KEY": "sk_sandbox_..." } }
 */

const BASE_URL = process.env.FURLPAY_BASE_URL || "http://localhost:3000";
const API_KEY = process.env.FURLPAY_API_KEY || "sk_sandbox_demo";

const TOOLS = [
  {
    name: "get_wallet_balances",
    description: "Fetch the user's Safe smart account stablecoin balances and active modules.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => api("GET", "/api/wallets"),
  },
  {
    name: "quote_swap",
    description: "Get the cheapest cross-chain stablecoin swap route (Li.Fi/1inch).",
    inputSchema: {
      type: "object",
      properties: {
        fromToken: { type: "string" }, toToken: { type: "string" },
        fromChain: { type: "string" }, amountIn: { type: "number" },
      },
      required: ["fromToken", "toToken", "fromChain", "amountIn"],
    },
    handler: (a) => api("POST", "/api/swaps", a),
  },
  {
    name: "place_investment_order",
    description: "Place a fractional stock/ETF order (Alpaca).",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" }, side: { type: "string", enum: ["buy", "sell"] },
        notional: { type: "number" },
      },
      required: ["symbol", "side", "notional"],
    },
    handler: (a) => api("POST", "/api/investing/order", a),
  },
  {
    name: "screen_wallet_risk",
    description: "AML-screen a wallet address (Chainalysis/TRM) and return a risk verdict.",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string" } },
      required: ["address"],
    },
    handler: (a) => api("GET", `/api/compliance?address=${encodeURIComponent(a.address)}`),
  },
  {
    name: "verify_identity",
    description: "Run a KYC identity check (Persona/Sumsub).",
    inputSchema: {
      type: "object",
      properties: {
        fullName: { type: "string" }, dateOfBirth: { type: "string" }, documentNumber: { type: "string" },
      },
      required: ["fullName", "dateOfBirth", "documentNumber"],
    },
    handler: (a) => api("POST", "/api/compliance/kyc", a),
  },
];

async function api(method, path, body) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// ---- JSON-RPC over stdio ----
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) handleMessage(line);
  }
});

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handleMessage(line) {
  let req;
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
          serverInfo: { name: "furlpay-mcp", version: "0.1.0" },
        },
      });
    }

    if (method === "tools/list") {
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        },
      });
    }

    if (method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) throw new Error(`Unknown tool: ${params.name}`);
      const result = await tool.handler(params.arguments || {});
      return send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    }

    if (method && method.startsWith("notifications/")) return; // no-op

    throw new Error(`Method not found: ${method}`);
  } catch (e) {
    send({ jsonrpc: "2.0", id, error: { code: -32000, message: e.message } });
  }
}

process.stderr.write(`furlpay-mcp ready (base=${BASE_URL})\n`);
