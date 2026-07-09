// One-time setup for the FurlPay cNFT ticket tree (Bubblegum v2).
// Generates a payer keypair, funds it (devnet airdrop), creates a Merkle tree
// sized for ~16k tickets, and prints the env lines the web app reads.
//
//   npx tsx scripts/setup-cnft-tree.mts            # devnet (default, free)
//   CNFT_NETWORK=mainnet npx tsx scripts/setup-cnft-tree.mts  # mainnet (payer must be pre-funded)
//
// Secrets land in .cnft-payer.json (gitignored) and are echoed as env lines.

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { generateSigner, keypairIdentity, sol } from "@metaplex-foundation/umi";
import { createTreeV2, mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import * as fs from "fs";
import * as path from "path";

const NETWORK = process.env.CNFT_NETWORK === "mainnet" ? "mainnet" : "devnet";
const API_KEY = process.env.HELIUS_API_KEY;
if (!API_KEY) throw new Error("Set HELIUS_API_KEY first (apps/web/.env.local has it).");
const RPC = `https://${NETWORK}.helius-rpc.com/?api-key=${API_KEY}`;

const PAYER_FILE = path.join(process.cwd(), ".cnft-payer.json");

async function main() {
  const umi = createUmi(RPC).use(mplBubblegum());

  // Load or create the payer keypair.
  let secret: number[];
  if (fs.existsSync(PAYER_FILE)) {
    secret = JSON.parse(fs.readFileSync(PAYER_FILE, "utf8"));
    console.log("Using existing payer keypair from .cnft-payer.json");
  } else {
    const kp = generateSigner(umi);
    secret = Array.from(kp.secretKey);
    fs.writeFileSync(PAYER_FILE, JSON.stringify(secret));
    console.log("Generated new payer keypair -> .cnft-payer.json");
  }
  const payer = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secret));
  umi.use(keypairIdentity(payer));
  console.log(`Payer:   ${payer.publicKey}`);
  console.log(`Network: ${NETWORK}`);

  // Fund on devnet; mainnet requires a pre-funded payer.
  const lamports = async () => Number((await umi.rpc.getBalance(payer.publicKey)).basisPoints);
  console.log(`Balance: ${(await lamports()) / 1e9} SOL`);
  if ((await lamports()) < 0.05 * 1e9) {
    if (NETWORK === "devnet") {
      console.log("Requesting devnet airdrop (1 SOL)…");
      try {
        await umi.rpc.airdrop(payer.publicKey, sol(1), { commitment: "confirmed" });
      } catch {
        // Helius devnet may gate airdrops — use the public faucet RPC.
        console.log("Helius airdrop unavailable, trying public devnet faucet…");
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const conn = new Connection("https://api.devnet.solana.com", "confirmed");
        const sig = await conn.requestAirdrop(new PublicKey(payer.publicKey), 1e9);
        await conn.confirmTransaction(sig, "confirmed");
      }
      // Wait until the credit is visible to the Helius RPC we mint through.
      for (let i = 0; i < 30 && (await lamports()) < 0.05 * 1e9; i++) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      console.log(`Balance after airdrop: ${(await lamports()) / 1e9} SOL`);
      if ((await lamports()) < 0.05 * 1e9) {
        throw new Error(`Airdrop never landed — fund ${payer.publicKey} manually via faucet.solana.com`);
      }
    } else {
      throw new Error(`Fund the payer with ~0.05 SOL on mainnet: ${payer.publicKey}`);
    }
  }

  // maxDepth 14 / buffer 64 → 16,384 leaves; plenty for the ticket program.
  const merkleTree = generateSigner(umi);
  console.log("Creating Bubblegum v2 tree…");
  const builder = await createTreeV2(umi, {
    merkleTree,
    maxDepth: 14,
    maxBufferSize: 64,
    public: false,
  });
  await builder.sendAndConfirm(umi);

  console.log(`\nTree created: ${merkleTree.publicKey}`);
  console.log("\nAdd to apps/web/.env.local:");
  console.log(`CNFT_MERKLE_TREE=${merkleTree.publicKey}`);
  console.log(`CNFT_NETWORK=${NETWORK}`);
  console.log(`SOLANA_PAYER_SECRET=${JSON.stringify(secret)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
