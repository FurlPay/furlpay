import { publicOrigin } from "@/lib/publicOrigin";
import { readJsonBody } from "@/lib/validate";
import {
  ActionGetResponse,
  ActionPostRequest,
  ActionPostResponse,
  createActionHeaders,
  createPostResponse,
} from "@solana/actions";
import { PublicKey } from "@solana/web3.js";
import { buildPaymentTransaction, getOrder, furlPaymentsEnabled, MerchantWalletNotConfiguredError, type PayAsset } from "@/lib/actions/solana";
import { demoOnlyUnavailableWithHeaders } from "@/lib/demoGate";

// Solana Actions require CORS + version/chain compatibility headers (sRFC 31).
// createActionHeaders bundles ACTIONS_CORS_HEADERS with X-Action-Version and
// X-Blockchain-Ids for the target chain.
const headers = createActionHeaders({ chainId: "mainnet", actionVersion: "2.4" });

// CORS preflight — clients probe this before GET/POST.
export const OPTIONS = async () => new Response(null, { headers });

// getOrder() has no order store: it answers $25 for ANY order id. Building a
// real mainnet transfer for an order nobody created is a payment for nothing,
// so production refuses until orders are real (created, owned, priced).
const ORDERS_REASON = "Blink checkout has no order store yet; every order id resolved to a fixed $25.";

// GET /api/actions/pay/[orderId] — metadata used to render the Blink widget.
export const GET = async (req: Request, props: { params: Promise<{ orderId: string }> }) => {
  const gate = demoOnlyUnavailableWithHeaders(headers, "Blink checkout", ORDERS_REASON);
  if (gate) return gate;
  const params = await props.params;
  const order = getOrder(params.orderId);
  const base = publicOrigin(req);
  const price = order.amountUsd.toFixed(2);

  const payload: ActionGetResponse = {
    type: "action",
    icon: `${base}/icon.png`,
    title: "Furlpay Secure Checkout",
    // The asset list tracks what the buttons below actually offer. Saying "USDC
    // or SOL" while rendering a FURL button (or vice versa) is a small lie on a
    // payment screen, which is the worst place to have one.
    description:
      `Pay for order #${order.orderId} instantly on Solana with ` +
      `${furlPaymentsEnabled() ? "USDC, SOL or FURL" : "USDC or SOL"}` +
      ` — sub-second finality, sub-cent fees.`,
    label: `Pay $${price}`,
    links: {
      actions: [
        {
          type: "transaction",
          label: `Pay $${price} USDC`,
          href: `/api/actions/pay/${order.orderId}?asset=USDC`,
        },
        {
          type: "transaction",
          label: `Pay $${price} in SOL`,
          href: `/api/actions/pay/${order.orderId}?asset=SOL`,
        },
        // FURL is only offered when a real FURL price is configured — it has no
        // oracle yet, so we never advertise a checkout we cannot price honestly.
        ...(furlPaymentsEnabled()
          ? [
              {
                type: "transaction" as const,
                label: `Pay $${price} in FURL`,
                href: `/api/actions/pay/${order.orderId}?asset=FURL`,
              },
            ]
          : []),
      ],
    },
  };

  return Response.json(payload, { headers });
};

// POST /api/actions/pay/[orderId] — return the serialized transaction to sign.
export const POST = async (req: Request, props: { params: Promise<{ orderId: string }> }) => {
  const gate = demoOnlyUnavailableWithHeaders(headers, "Blink checkout", ORDERS_REASON);
  if (gate) return gate;
  const params = await props.params;
  try {
    const body: ActionPostRequest = await readJsonBody(req);

    let payer: PublicKey;
    try {
      payer = new PublicKey(body.account);
    } catch {
      return Response.json(
        { message: 'Invalid "account" — expected a base58 Solana public key.' },
        { status: 400, headers }
      );
    }

    const asset = (
      new URL(req.url).searchParams.get("asset") || "USDC"
    ).toUpperCase();
    if (asset !== "SOL" && asset !== "USDC" && asset !== "FURL") {
      return Response.json(
        { message: `Unsupported asset "${asset}". Use SOL, USDC or FURL.` },
        { status: 400, headers }
      );
    }
    if (asset === "FURL" && !furlPaymentsEnabled()) {
      return Response.json(
        { message: "FURL payments are not enabled on this deployment." },
        { status: 400, headers }
      );
    }

    const order = getOrder(params.orderId);
    const transaction = await buildPaymentTransaction({
      payer,
      amountUsd: order.amountUsd,
      asset: asset as PayAsset,
    });

    // createPostResponse serializes the transaction to base64 (requireAllSignatures
    // / verifySignatures = false) and shapes the spec-compliant response body.
    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        type: "transaction",
        transaction,
        message: `Confirm payment of $${order.amountUsd.toFixed(2)} in ${asset} for order #${order.orderId}`,
      },
    });

    return Response.json(payload, { headers });
  } catch (err) {
    if (err instanceof MerchantWalletNotConfiguredError) {
      return Response.json({ message: "Payments are not available on this deployment." }, { status: 503, headers });
    }
    const message = err instanceof Error ? err.message : "Unable to build transaction.";
    return Response.json({ message }, { status: 400, headers });
  }
};
