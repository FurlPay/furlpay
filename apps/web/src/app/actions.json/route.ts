import { ActionsJson, createActionHeaders } from "@solana/actions";

// Served at https://<domain>/actions.json — tells Blink clients which site paths
// map to Action API endpoints. Must return CORS headers for GET and OPTIONS.
const headers = createActionHeaders();

export const GET = async () => {
  const payload: ActionsJson = {
    rules: [
      // Shareable checkout links (furlpay.app/pay/<orderId>) resolve to the API.
      { pathPattern: "/pay/**", apiPath: "/api/actions/pay/**" },
      // Idempotent mapping so the API routes are themselves discoverable.
      { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
    ],
  };

  return Response.json(payload, { headers });
};

export const OPTIONS = GET;
