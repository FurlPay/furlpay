/**
 * x402 AI Agent — Autonomously books a hotel by paying USDC on Arbitrum
 *
 * This is the "AI agent" side of the x402 protocol demo. It:
 *   1. Requests a hotel room (GET)
 *   2. Receives HTTP 402 with payment instructions
 *   3. Signs an EIP-3009 USDC transferWithAuthorization
 *   4. Submits it to X402Facilitator on Arbitrum Sepolia
 *   5. Retries the request with X-Payment-Proof header
 *   6. Receives booking confirmation
 *
 * Run: npx tsx src/bookHotel.ts
 * Requires: hotelServer.ts running + contracts deployed on Arbitrum Sepolia
 */

import { ethers } from "ethers";
import "dotenv/config";

// ── Config ──────────────────────────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY;
const FACILITATOR_ADDR = process.env.X402_FACILITATOR_ADDRESS;
const HOTEL_API = process.env.HOTEL_API_URL || "http://localhost:3402";

if (!AGENT_KEY) throw new Error("Set AGENT_PRIVATE_KEY in .env");
if (!FACILITATOR_ADDR) throw new Error("Set X402_FACILITATOR_ADDRESS in .env");

// ── ABIs ────────────────────────────────────────────────────────────────────
const FACILITATOR_ABI = [
  "function settle(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes32 resourceHash, uint8 v, bytes32 r, bytes32 s) external",
  "function settlements(bytes32 nonce) view returns (address payer, address payTo, uint256 amount, bytes32 resourceHash, uint64 settledAt)",
];

// EIP-3009 domain and types for USDC on Arbitrum Sepolia
const USDC_ABI = [
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external",
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
];

// ── Main Agent Flow ─────────────────────────────────────────────────────────
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   FurlPay x402 AI Agent                                     ║
║                                                              ║
║   Protocol: x402/1.0                                         ║
║   Network:  Arbitrum Sepolia                                 ║
║   Task:     Book a hotel room autonomously                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const agent = new ethers.Wallet(AGENT_KEY!, provider); // guarded at module load (line 25)
  console.log(`Agent wallet: ${agent.address}`);

  // ── Step 1: List available hotels ────────────────────────────────────────
  console.log("\nStep 1: Listing available hotels...");
  const hotelsRes = await fetch(`${HOTEL_API}/api/hotels`);
  const { hotels } = await hotelsRes.json() as { hotels: Array<{ id: string; name: string; city: string; priceUSDC: number }> };
  
  console.log("\n   Available hotels:");
  for (const h of hotels) {
    console.log(`   • ${h.name} (${h.city}) — ${h.priceUSDC} USDC/night`);
  }

  // ── Step 2: Request a specific room ──────────────────────────────────────
  const targetHotel = "tokyo-grand";
  const targetRoom = "101";
  console.log(`\nStep 2: Requesting ${targetHotel} room ${targetRoom}...`);

  const roomRes = await fetch(`${HOTEL_API}/api/hotels/${targetHotel}/rooms/${targetRoom}`);
  
  if (roomRes.status === 402) {
    console.log(`\nStep 3: Received HTTP 402 — Payment Required!`);
    
    // Parse x402 payment headers
    const paymentAmount = roomRes.headers.get("x-payment-amount")!;
    const paymentToken = roomRes.headers.get("x-payment-token")!;
    const paymentRecipient = roomRes.headers.get("x-payment-recipient")!;
    const paymentFacilitator = roomRes.headers.get("x-payment-facilitator")!;
    const resourceHash = roomRes.headers.get("x-payment-resource-hash")!;
    const protocol = roomRes.headers.get("x-payment-protocol");

    console.log(`   Protocol:    ${protocol}`);
    console.log(`   Amount:      ${Number(paymentAmount) / 1e6} USDC`);
    console.log(`   Token:       ${paymentToken}`);
    console.log(`   Recipient:   ${paymentRecipient}`);
    console.log(`   Facilitator: ${paymentFacilitator}`);
    console.log(`   Resource:    ${resourceHash}`);

    // Check USDC balance
    const usdc = new ethers.Contract(paymentToken, USDC_ABI, agent);
    const balance = await usdc.balanceOf(agent.address);
    console.log(`\n   Agent USDC balance: ${Number(balance) / 1e6} USDC`);

    if (balance < BigInt(paymentAmount)) {
      console.log(`\n   WARNING: Insufficient USDC balance for payment.`);
      console.log(`   Need: ${Number(paymentAmount) / 1e6} USDC`);
      console.log(`   Have: ${Number(balance) / 1e6} USDC`);
      console.log(`\n   To continue the demo, mint test USDC or fund the agent wallet.`);
      console.log(`   Agent address: ${agent.address}`);
      
      // Demo mode: simulate the payment
      console.log(`\n   Demo mode: Simulating payment...`);
      await simulatePayment(targetHotel, targetRoom);
      return;
    }

    // ── Step 4: Sign EIP-3009 authorization ──────────────────────────────
    console.log(`\nStep 4: Signing EIP-3009 USDC authorization...`);

    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const validAfter = 0;
    const validBefore = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    // EIP-3009 TransferWithAuthorization domain + types
    const domain = {
      name: await usdc.name(),
      version: await usdc.version().catch(() => "2"),
      chainId: (await provider.getNetwork()).chainId,
      verifyingContract: paymentToken,
    };

    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };

    const value = {
      from: agent.address,
      to: paymentRecipient,
      value: paymentAmount,
      validAfter,
      validBefore,
      nonce,
    };

    const signature = await agent.signTypedData(domain, types, value);
    const { v, r, s } = ethers.Signature.from(signature);

    console.log(`   Authorization signed!`);
    console.log(`   Nonce:   ${nonce}`);
    console.log(`   Valid:   now → ${new Date(validBefore * 1000).toISOString()}`);

    // ── Step 5: Submit to X402Facilitator on Arbitrum ─────────────────────
    console.log(`\nStep 5: Settling on X402Facilitator (Arbitrum Sepolia)...`);

    const facilitator = new ethers.Contract(paymentFacilitator, FACILITATOR_ABI, agent);
    
    const tx = await facilitator.settle(
      agent.address,       // from
      paymentRecipient,    // to
      paymentAmount,       // value
      validAfter,          // validAfter
      validBefore,         // validBefore
      nonce,               // nonce
      resourceHash,        // resourceHash
      v, r, s              // signature
    );

    console.log(`   Transaction submitted: ${tx.hash}`);
    console.log(`   Waiting for confirmation...`);

    const receipt = await tx.wait();
    console.log(`   ✅ Settled in block ${receipt!.blockNumber}!`);
    console.log(`   Gas used: ${receipt!.gasUsed.toString()}`);

    // ── Step 6: Retry with payment proof ─────────────────────────────────
    console.log(`\nStep 6: Retrying request with payment proof...`);

    const bookingRes = await fetch(`${HOTEL_API}/api/hotels/${targetHotel}/rooms/${targetRoom}`, {
      headers: { "X-Payment-Proof": tx.hash },
    });

    if (bookingRes.status === 200) {
      const booking = await bookingRes.json();
      console.log(`\nBOOKING CONFIRMED`);
      console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`   Booking ID:  ${(booking as any).bookingId}`);
      console.log(`   Hotel:       ${(booking as any).hotel}`);
      console.log(`   Room:        ${(booking as any).room?.type} (#${(booking as any).room?.id})`);
      console.log(`   Paid:        ${(booking as any).amountPaid}`);
      console.log(`   Settled on:  ${(booking as any).settledOn}`);
      console.log(`   TX Hash:     ${(booking as any).txHash}`);
      console.log(`   Check-in:    ${(booking as any).checkIn}`);
      console.log(`   Check-out:   ${(booking as any).checkOut}`);
      console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`\n   The AI agent autonomously booked a hotel room`);
      console.log(`   by paying USDC on Arbitrum via the x402 protocol.`);
      console.log(`   No human intervention required.\n`);
    } else {
      console.log(`   ❌ Booking failed: ${bookingRes.status}`);
    }
  } else if (roomRes.status === 200) {
    console.log(`   ✅ Room available (no payment required — already paid?)`);
  } else {
    console.log(`   ❌ Unexpected response: ${roomRes.status}`);
  }
}

// ── Demo mode: simulate without on-chain tx ─────────────────────────────────
async function simulatePayment(hotelId: string, roomId: string) {
  console.log(`\nSimulating x402 payment flow...`);
  
  const fakeTxHash = `0x${Buffer.from(ethers.randomBytes(32)).toString("hex")}`;
  console.log(`   Simulated TX: ${fakeTxHash}`);

  const bookingRes = await fetch(`${HOTEL_API}/api/hotels/${hotelId}/rooms/${roomId}`, {
    headers: { "X-Payment-Proof": fakeTxHash },
  });

  if (bookingRes.status === 200) {
    const booking = await bookingRes.json();
    console.log(`\nDEMO BOOKING CONFIRMED`);
    console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   Booking ID:  ${(booking as any).bookingId}`);
    console.log(`   Hotel:       ${(booking as any).hotel}`);
    console.log(`   Room:        ${(booking as any).room?.type}`);
    console.log(`   Paid:        ${(booking as any).amountPaid}`);
    console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`\n   Note: this was a simulated demo. For the real flow,`);
    console.log(`   fund the agent with testnet USDC and deploy contracts.`);
  }
}

main().catch(console.error);
