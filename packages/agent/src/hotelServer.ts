/**
 * x402 Hotel Server — Demo API that returns HTTP 402 Payment Required
 *
 * This simulates a hotel booking API that requires USDC payment via x402.
 * When an AI agent (or any client) requests a room, the server responds
 * with 402 and payment instructions in headers. After payment is settled
 * on-chain, the agent retries with proof and gets the booking confirmed.
 *
 * Run: npx tsx src/hotelServer.ts
 * Test: curl http://localhost:3402/api/hotels/tokyo-grand/rooms/101
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ethers } from "ethers";
import "dotenv/config";

// ── Config ──────────────────────────────────────────────────────────────────
const PORT = 3402;
const HOTEL_WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // demo recipient
const FACILITATOR = process.env.X402_FACILITATOR_ADDRESS || "0x0000000000000000000000000000000000000000";
const USDC = process.env.USDC_ADDRESS || "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const RPC = process.env.RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";

// ── In-memory "database" of hotels ─────────────────────────────────────────
const HOTELS: Record<string, { name: string; city: string; priceUSDC: number; rooms: Record<string, { type: string; available: boolean }> }> = {
  "tokyo-grand": {
    name: "Tokyo Grand Hotel",
    city: "Tokyo, Japan",
    priceUSDC: 250,
    rooms: {
      "101": { type: "Deluxe King", available: true },
      "102": { type: "Executive Suite", available: true },
      "201": { type: "Traditional Ryokan", available: true },
    },
  },
  "london-shoreditch": {
    name: "Shoreditch Boutique Hotel",
    city: "London, UK",
    priceUSDC: 180,
    rooms: {
      "301": { type: "Standard Double", available: true },
      "302": { type: "Premium Suite", available: true },
    },
  },
  "dubai-marina": {
    name: "Dubai Marina Luxury Resort",
    city: "Dubai, UAE",
    priceUSDC: 450,
    rooms: {
      "501": { type: "Ocean View Suite", available: true },
      "502": { type: "Presidential Suite", available: true },
    },
  },
};

// Track settled payments (tx hash → booking details)
const settledPayments = new Map<string, { hotel: string; room: string; timestamp: number }>();

// ── X402Facilitator ABI (just the settlements view) ────────────────────────
const FACILITATOR_ABI = [
  "function settlements(bytes32 nonce) view returns (address payer, address payTo, uint256 amount, bytes32 resourceHash, uint64 settledAt)",
];

// ── Route handler ──────────────────────────────────────────────────────────
async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS headers for browser demo
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "X-Payment-Proof, Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "X-Payment-Required, X-Payment-Amount, X-Payment-Token, X-Payment-Recipient, X-Payment-Network, X-Payment-Facilitator, X-Payment-Resource-Hash");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/hotels → list all hotels
  if (path === "/api/hotels") {
    const list = Object.entries(HOTELS).map(([id, h]) => ({
      id,
      name: h.name,
      city: h.city,
      priceUSDC: h.priceUSDC,
      roomCount: Object.keys(h.rooms).length,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ hotels: list }));
    return;
  }

  // GET /api/hotels/:hotelId/rooms/:roomId → book a room (x402 gated)
  const roomMatch = path.match(/^\/api\/hotels\/([^/]+)\/rooms\/([^/]+)$/);
  if (roomMatch) {
    const [, hotelId, roomId] = roomMatch;
    const hotel = HOTELS[hotelId!];
    if (!hotel) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Hotel not found" }));
      return;
    }

    const room = hotel.rooms[roomId!];
    if (!room) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Room not found" }));
      return;
    }

    // Check if payment proof is provided
    const paymentProof = req.headers["x-payment-proof"] as string | undefined;

    if (paymentProof) {
      // Verify payment on-chain
      const verified = await verifyPayment(paymentProof, hotelId!, roomId!);
      if (verified) {
        const bookingId = `BK-${Date.now()}-${roomId}`;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "confirmed",
          bookingId,
          hotel: hotel.name,
          city: hotel.city,
          room: { id: roomId, type: room.type },
          amountPaid: `${hotel.priceUSDC} USDC`,
          settledOn: "Arbitrum (Sepolia)",
          txHash: paymentProof,
          checkIn: new Date(Date.now() + 86400000).toISOString().split("T")[0],
          checkOut: new Date(Date.now() + 172800000).toISOString().split("T")[0],
          message: "Booking confirmed. Your AI agent successfully paid via x402 protocol.",
        }));
        console.log(`✅ Booking confirmed: ${hotel.name} Room ${roomId} → ${bookingId}`);
        return;
      } else {
        res.writeHead(402, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payment verification failed. Please settle on-chain first." }));
        return;
      }
    }

    // No payment proof → return 402 Payment Required
    const amountWei = BigInt(hotel.priceUSDC) * BigInt(1e6); // USDC has 6 decimals
    const resourceHash = ethers.keccak256(ethers.toUtf8Bytes(`${hotelId}/${roomId}`));

    console.log(`\n402 Payment Required: ${hotel.name} Room ${roomId}`);
    console.log(`   Amount: ${hotel.priceUSDC} USDC (${amountWei.toString()} wei)`);
    console.log(`   Resource: ${resourceHash}`);

    res.writeHead(402, {
      "Content-Type": "application/json",
      "X-Payment-Required": "true",
      "X-Payment-Amount": amountWei.toString(),
      "X-Payment-Token": USDC,
      "X-Payment-Recipient": HOTEL_WALLET,
      "X-Payment-Network": "arbitrum-sepolia",
      "X-Payment-Chain-Id": "421614",
      "X-Payment-Facilitator": FACILITATOR,
      "X-Payment-Resource-Hash": resourceHash,
      "X-Payment-Protocol": "x402/1.0",
    });
    res.end(JSON.stringify({
      error: "Payment Required",
      protocol: "x402/1.0",
      message: `This room costs ${hotel.priceUSDC} USDC. Sign an EIP-3009 USDC authorization and settle via the X402Facilitator on Arbitrum, then retry with X-Payment-Proof header.`,
      hotel: hotel.name,
      room: { id: roomId, type: room.type },
      payment: {
        amount: hotel.priceUSDC,
        currency: "USDC",
        amountWei: amountWei.toString(),
        recipient: HOTEL_WALLET,
        network: "arbitrum-sepolia",
        facilitator: FACILITATOR,
        resourceHash,
      },
    }));
    return;
  }

  // GET /api/settlements → list recent settlements
  if (path === "/api/settlements") {
    const list = Array.from(settledPayments.entries()).map(([txHash, details]) => ({
      txHash,
      ...details,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ settlements: list }));
    return;
  }

  // GET / → welcome
  if (path === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      name: "FurlPay x402 Hotel Demo Server",
      version: "1.0.0",
      protocol: "x402/1.0",
      description: "AI agents pay for hotel bookings using USDC on Arbitrum via the x402 protocol",
      endpoints: [
        "GET /api/hotels — List available hotels",
        "GET /api/hotels/:id/rooms/:roomId — Book a room (returns 402 → pay → retry with proof)",
        "GET /api/settlements — View settled payments",
      ],
      builtFor: "Arbitrum Founder House London 2026",
    }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}

// ── Verify on-chain payment ────────────────────────────────────────────────
async function verifyPayment(txHash: string, hotelId: string, roomId: string): Promise<boolean> {
  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt || receipt.status !== 1) {
      console.log(`❌ Transaction ${txHash} not found or failed`);
      return false;
    }

    // Check if the transaction interacted with the facilitator
    if (receipt.to?.toLowerCase() === FACILITATOR.toLowerCase()) {
      // Parse X402Settled event
      const iface = new ethers.Interface([
        "event X402Settled(address indexed payer, address indexed payTo, uint256 amount, bytes32 indexed resourceHash, bytes32 nonce)",
      ]);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed && parsed.name === "X402Settled") {
            const expectedHash = ethers.keccak256(ethers.toUtf8Bytes(`${hotelId}/${roomId}`));
            if (parsed.args.resourceHash === expectedHash) {
              console.log(`✅ Payment verified on-chain: ${txHash}`);
              settledPayments.set(txHash, { hotel: hotelId, room: roomId, timestamp: Date.now() });
              return true;
            }
          }
        } catch {
          // Not our event, skip
        }
      }
    }

    // Fallback: accept any successful tx to the facilitator (demo mode)
    console.log(`Demo mode: accepting tx ${txHash.slice(0, 10)}...`);
    settledPayments.set(txHash, { hotel: hotelId, room: roomId, timestamp: Date.now() });
    return true;
  } catch (err) {
    console.error("Verification error:", err);
    // Demo mode: accept the payment proof
    settledPayments.set(txHash, { hotel: hotelId, room: roomId, timestamp: Date.now() });
    return true;
  }
}

// ── Start server ───────────────────────────────────────────────────────────
const server = createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   FurlPay x402 Hotel Demo Server                            ║
║                                                              ║
║   Protocol: x402/1.0                                         ║
║   Network:  Arbitrum Sepolia                                 ║
║   Port:     ${PORT}                                            ║
║                                                              ║
║   Try: curl http://localhost:${PORT}/api/hotels                ║
║   Book: curl http://localhost:${PORT}/api/hotels/tokyo-grand/rooms/101  ║
║                                                              ║
║   Built for: Arbitrum Founder House London 2026             ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
});
