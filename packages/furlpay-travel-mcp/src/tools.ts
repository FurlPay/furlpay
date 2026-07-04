import { TravelClient } from "./travel";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: any) => Promise<unknown> | unknown;
}

/** Build the MCP toolset bound to a TravelClient. */
export function buildTools(client: TravelClient): McpTool[] {
  return [
    {
      name: "travel_search_stays",
      description:
        "Search Travala's 2.2M+ hotels (Marriott, Hilton, IHG, …) for a city and date range. Returns quotes with a quoteId to book.",
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string" },
          checkIn: { type: "string", description: "YYYY-MM-DD" },
          checkOut: { type: "string", description: "YYYY-MM-DD" },
          maxNightlyUsd: { type: "number", description: "Optional nightly price cap in USD" },
          guests: { type: "number" },
        },
        required: ["city", "checkIn", "checkOut"],
      },
      handler: (a) => client.searchStays(a),
    },
    {
      name: "travel_search_flights",
      description:
        "Search flights for a route and date. With DUFFEL_API_KEY set, returns live real-time offers (NDC/GDS/LCC, 300+ airlines via Duffel); otherwise Travala/demo inventory. Returns quotes with a quoteId.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Origin IATA code" },
          to: { type: "string", description: "Destination IATA code" },
          date: { type: "string", description: "YYYY-MM-DD" },
          cabin: { type: "string", enum: ["economy", "premium_economy", "business", "first"] },
        },
        required: ["from", "to", "date"],
      },
      handler: (a) => client.searchFlights(a),
    },
    {
      name: "travel_set_agent_budget",
      description: "Set a USDC spend cap for an agent before it books autonomously.",
      inputSchema: {
        type: "object",
        properties: { agentId: { type: "string" }, limitUsd: { type: "number" } },
        required: ["agentId", "limitUsd"],
      },
      handler: (a) => {
        client.setAgentBudget(a.agentId, a.limitUsd);
        return client.getAgentBudget(a.agentId);
      },
    },
    {
      name: "travel_authorize_booking",
      description:
        "Authorize payment for a booking within the agent's budget. source='travala' pays via x402/USDC on Base and accrues the 10% cbBTC rebate; source='legacy' issues a single-use, MCC-locked Visa virtual card for Web2 merchants (Airbnb, Skyscanner). If the server enforces agent mandates (TAP-style), pass the mandateToken created with @furlpay/agent-trust — it must sign this exact amount/mcc/source.",
      inputSchema: {
        type: "object",
        properties: {
          amountUsd: { type: "number" },
          source: { type: "string", enum: ["travala", "legacy"] },
          currency: { type: "string", description: "Default USDC" },
          mcc: { type: "string", description: "Merchant Category Code lock for the legacy route, e.g. 7011 (lodging)" },
          agentId: { type: "string" },
          reference: { type: "string", description: "Quote/booking reference" },
          mandateToken: {
            type: "string",
            description:
              "TAP-style booking token: agent-signed intent under a user-signed spend mandate (@furlpay/agent-trust createBookingToken). Required when the server has a MandateVerifier configured.",
          },
        },
        required: ["amountUsd", "source"],
      },
      handler: (a) => client.authorizeBooking(a),
    },
    {
      name: "travel_confirm_booking",
      description: "Confirm an authorized booking (after passkey step-up in a real flow).",
      inputSchema: {
        type: "object",
        properties: { bookingId: { type: "string" } },
        required: ["bookingId"],
      },
      handler: (a) => client.confirmBooking(a.bookingId),
    },
    {
      name: "travel_cancel_booking",
      description: "Cancel a booking and void its authorization.",
      inputSchema: {
        type: "object",
        properties: { bookingId: { type: "string" } },
        required: ["bookingId"],
      },
      handler: (a) => client.cancelBooking(a.bookingId),
    },
    {
      name: "travel_list_rebates",
      description: "List accumulated 10% cbBTC developer rebates from Travala-routed bookings (7% developer / 3% treasury split).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: () => client.listRebates(),
    },
  ];
}
