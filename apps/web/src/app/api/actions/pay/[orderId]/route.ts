import {
  ActionGetResponse,
  ActionPostRequest,
  ActionPostResponse,
  createActionHeaders,
  createPostResponse,
} from "@solana/actions";
import { PublicKey } from "@solana/web3.js";
import { buildPaymentTransaction, getOrder, type PayAsset } from "@/lib/actions/solana";

// Solana Actions require CORS + version/chain compatibility headers (sRFC 31).
// createActionHeaders bundles ACTIONS_CORS_HEADERS with X-Action-Version and
// X-Blockchain-Ids for the target chain.
const headers = createActionHeaders({ chainId: "mainnet", actionVersion: "2.4" });

// CORS preflight — clients probe this before GET/POST.
export const OPTIONS = async () => new Response(null, { headers });

// GET /api/actions/pay/[orderId] — metadata used to render the Blink widget.
export const GET = async (
  req: Request,
  { params }: { params: { orderId: string } }
) => {
  const order = getOrder(params.orderId);
  const base = new URL(req.url).origin;
  const price = order.amountUsd.toFixed(2);

  const payload: ActionGetResponse = {
    type: "action",
    icon: `${base}/icon.png`,
    title: "Furlpay Secure Checkout",
    description: `Pay for order #${order.orderId} instantly on Solana with USDC or SOL — sub-second finality, sub-cent fees.`,
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
      ],
    },
  };

  return Response.json(payload, { headers });
};

// POST /api/actions/pay/[orderId] — return the serialized transaction to sign.
export const POST = async (
  req: Request,
  { params }: { params: { orderId: string } }
) => {
  try {
    const body: ActionPostRequest = await req.json();

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
    if (asset !== "SOL" && asset !== "USDC") {
      return Response.json(
        { message: `Unsupported asset "${asset}". Use SOL or USDC.` },
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
    const message = err instanceof Error ? err.message : "Unable to build transaction.";
    return Response.json({ message }, { status: 400, headers });
  }
};
