import {
  ActionGetResponse,
  ActionPostRequest,
  ActionPostResponse,
  createActionHeaders,
  createPostResponse,
} from "@solana/actions";
import { PublicKey } from "@solana/web3.js";
import { buildPaymentTransaction } from "@/lib/actions/solana";
import { authorizeBooking, generateCars, MCC, type CarRental } from "@/lib/travel/data";
import { addTrip } from "@/lib/travel/store";
import { mintTicketCnft } from "@/lib/travel/cnft";
import { acquireLock, releaseLock } from "@/lib/locks";
import { limit } from "@/lib/rateLimit";

// Solana Action: book a rental car straight from a Blink (X, Reddit, Discord,
// wallet in-feed cards) — the playbook's "instant checkout moat". Inventory is
// deterministic per city (seeded), so a shared URL re-derives the exact car
// server-side without any state: /api/actions/book-car?city=Tokyo&car=<id>.
const headers = createActionHeaders({ chainId: "mainnet", actionVersion: "2.4" });

export const OPTIONS = async () => new Response(null, { headers });

const MAX_DAYS = 7;

// City names come from URLs shared on social feeds — accept letters, spaces
// and hyphens only, and cap the length before they reach inventory hashing.
function parseCity(raw: string | null): string | null {
  const city = (raw ?? "Tokyo").trim().slice(0, 40);
  return /^[\p{L} .'-]+$/u.test(city) ? city : null;
}

function findCar(city: string, carId: string | null): CarRental | undefined {
  const cars = generateCars(city);
  // No car specified → cheapest available (list is sorted by daily rate).
  return carId ? cars.find((c) => c.id === carId) : cars[0];
}

// GET — metadata the Blink client renders as an interactive card.
export const GET = async (req: Request) => {
  const url = new URL(req.url);
  const city = parseCity(url.searchParams.get("city"));
  if (!city) {
    return Response.json({ message: "Invalid city." }, { status: 400, headers });
  }
  const car = findCar(city, url.searchParams.get("car"));
  if (!car) {
    return Response.json({ message: "This vehicle is no longer available." }, { status: 404, headers });
  }

  const base = url.origin;
  const href =
    `/api/actions/book-car?city=${encodeURIComponent(city)}` +
    `&car=${encodeURIComponent(car.id)}&days={days}`;

  const payload: ActionGetResponse = {
    type: "action",
    icon: car.photo ?? `${base}/icon.png`,
    title: `Book ${car.make} ${car.model} — ${city}`,
    description:
      `${car.category} · ${car.seats} seats · ${car.transmission} · ${car.fuel} · ` +
      `${car.supplier} (${car.supplierRating}/10) · ${car.insurance} insurance · ` +
      `$${car.dailyUsd.toFixed(2)}/day in USDC${car.freeCancellation ? " · Free cancellation" : ""}. ` +
      `Powered by FurlPay Travel & Solana Pay.`,
    label: `Book from $${car.dailyUsd.toFixed(2)}`,
    links: {
      actions: [
        {
          type: "transaction",
          label: "Confirm booking",
          href,
          parameters: [
            {
              name: "days",
              label: `Number of days (1-${MAX_DAYS})`,
              required: true,
            },
          ],
        },
      ],
    },
  };

  return Response.json(payload, { headers });
};

// POST — return the USDC transfer transaction for the wallet to sign.
export const POST = async (req: Request) => {
  try {
    const url = new URL(req.url);
    const city = parseCity(url.searchParams.get("city"));
    if (!city) {
      return Response.json({ message: "Invalid city." }, { status: 400, headers });
    }
    const car = findCar(city, url.searchParams.get("car"));
    if (!car) {
      return Response.json({ message: "This vehicle is no longer available." }, { status: 404, headers });
    }

    const days = Number(url.searchParams.get("days"));
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      return Response.json(
        { message: `"days" must be a whole number between 1 and ${MAX_DAYS}.` },
        { status: 400, headers }
      );
    }

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

    // Anti-spam: 5 booking transactions per wallet per minute (rl:* in Redis,
    // global across instances).
    const rl = await limit(`actions.book-car:${payer.toBase58()}`, { limit: 5, windowMs: 60_000 });
    if (!rl.ok) {
      return Response.json(
        { message: "Too many booking attempts — try again in a moment." },
        { status: 429, headers }
      );
    }

    // Distributed mutex: a double-submitted Blink for the same wallet/vehicle
    // must not create two trips (lock:* in Redis).
    const lockName = `booking:${payer.toBase58()}:${car.id}:${days}`;
    const lockToken = await acquireLock(lockName, 30);
    if (!lockToken) {
      return Response.json(
        { message: "This booking is already being processed." },
        { status: 409, headers }
      );
    }

    try {
    const amountUsd = Math.round(car.dailyUsd * days * 100) / 100;
    const transaction = buildPaymentTransaction({ payer, amountUsd, asset: "USDC" });

    // Demo-ledger parity with /api/travel/book: authorize + record the trip at
    // build time. A production deployment records the booking as pending and
    // confirms it from an on-chain webhook once the signed transfer finalizes.
    const authorization = authorizeBooking(amountUsd, "travala", MCC.CAR_RENTAL);
    const checkIn = new Date(Date.now() + 86_400_000);
    const checkOut = new Date(checkIn.getTime() + days * 86_400_000);
    const trip = addTrip({
      id: "bk_" + Math.random().toString(36).slice(2, 10),
      name: `${car.make} ${car.model} (${car.supplier})`,
      city,
      image: car.image,
      checkIn: checkIn.toISOString().slice(0, 10),
      checkOut: checkOut.toISOString().slice(0, 10),
      nights: days,
      guests: car.seats,
      amountUsd,
      source: "travala",
      method: "USDC · Solana Blink",
      status: "confirmed",
      cashbackUsd: authorization.cashbackUsd,
      createdAt: new Date().toISOString(),
    });

    // Ticket voucher as a Bubblegum cNFT, minted straight to the paying wallet.
    // Never throws — falls back to a mock record if the mint API is down.
    trip.ticket = await mintTicketCnft({
      tripId: trip.id,
      name: `FurlPay Ticket · ${car.make} ${car.model} ${city}`,
      owner: payer.toBase58(),
      imageUrl: car.photo,
    });

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        type: "transaction",
        transaction,
        message:
          `Verify your booking of a ${car.make} ${car.model} in ${city} for ` +
          `${days} day${days === 1 ? "" : "s"} ($${amountUsd.toFixed(2)} USDC).`,
      },
    });

    return Response.json(payload, { headers });
    } finally {
      await releaseLock(lockName, lockToken);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to build transaction.";
    return Response.json({ message }, { status: 400, headers });
  }
};
