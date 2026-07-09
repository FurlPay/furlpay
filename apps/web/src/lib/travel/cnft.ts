// Compressed-NFT ticket receipts (Metaplex Bubblegum v2 on Solana).
//
// Every confirmed booking mints a ticket voucher as a cNFT — sub-cent fees at
// any scale, which is the point of compression. LIVE: Bubblegum v2 `mintV2`
// against FurlPay's own Merkle tree (Helius' hosted mintCompressedNft API was
// removed in 2026 — "Method no longer supported"). Run
// `npx tsx scripts/setup-cnft-tree.mts` once to create the tree and payer,
// then set CNFT_MERKLE_TREE / SOLANA_PAYER_SECRET / CNFT_NETWORK.
// MOCK (default, zero credentials): returns a deterministic asset id with the
// exact response shape, so the UI and receipts render identically.

export interface TicketCnft {
  assetId: string;
  name: string;
  uri: string;
  owner: string;
  network: "solana-mainnet" | "solana-devnet" | "mock";
  /** Transaction signature of the mint (live networks only). */
  signature?: string;
  mintedAt: string;
}

function liveConfigured(): boolean {
  return Boolean(
    process.env.HELIUS_API_KEY && process.env.CNFT_MERKLE_TREE && process.env.SOLANA_PAYER_SECRET
  );
}

/**
 * Mint a booking-ticket cNFT to `owner`. Never throws — ticketing is a
 * receipt, not the booking itself, so a mint failure degrades to the mock
 * record rather than failing the payment flow.
 */
export async function mintTicketCnft(opts: {
  tripId: string;
  name: string;
  owner: string; // Solana address; demo bookings use the merchant treasury
  imageUrl?: string;
}): Promise<TicketCnft> {
  const uri = `https://furlpay.com/api/travel/bookings/receipt/${opts.tripId}`;

  if (liveConfigured()) {
    try {
      return await mintLive(opts, uri);
    } catch (e) {
      // Fall through to the mock record; log so live-mode failures are visible.
      console.error("[cnft] live mint failed, using mock:", (e as Error)?.message);
    }
  }

  return {
    assetId: mockAssetId(opts.tripId),
    name: opts.name,
    uri,
    owner: opts.owner,
    network: "mock",
    mintedAt: new Date().toISOString(),
  };
}

async function mintLive(
  opts: { tripId: string; name: string; owner: string },
  uri: string
): Promise<TicketCnft> {
  // Dynamic imports keep the Metaplex stack out of every other route's bundle.
  const [{ createUmi }, umiCore, bubblegum] = await Promise.all([
    import("@metaplex-foundation/umi-bundle-defaults"),
    import("@metaplex-foundation/umi"),
    import("@metaplex-foundation/mpl-bubblegum"),
  ]);

  const network = process.env.CNFT_NETWORK === "mainnet" ? "mainnet" : "devnet";
  const rpc = `https://${network}.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  const umi = createUmi(rpc).use(bubblegum.mplBubblegum());

  const secret = Uint8Array.from(JSON.parse(process.env.SOLANA_PAYER_SECRET!));
  umi.use(umiCore.keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));

  const merkleTree = umiCore.publicKey(process.env.CNFT_MERKLE_TREE!);
  const leafOwner = umiCore.publicKey(opts.owner);

  const { signature } = await bubblegum
    .mintV2(umi, {
      merkleTree,
      leafOwner,
      metadata: {
        name: fitBytes(opts.name, 32), // on-chain limit is 32 BYTES, not chars
        uri,
        sellerFeeBasisPoints: 0,
        collection: umiCore.none(),
        creators: [],
      },
    })
    .sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });

  const sig = umiCore.base58.deserialize(signature)[0];

  // Resolve the asset id from the mint's leaf. The tx must be visible to the
  // RPC, so retry briefly; if it still races, fall back to a signature-derived
  // placeholder — the receipt endpoint stores the signature either way.
  let assetId = `pending:${sig.slice(0, 20)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const leaf = await bubblegum.parseLeafFromMintV2Transaction(umi, signature);
      assetId = bubblegum.findLeafAssetIdPda(umi, { merkleTree, leafIndex: leaf.nonce })[0];
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  return {
    assetId,
    name: opts.name,
    uri,
    owner: opts.owner,
    network: network === "mainnet" ? "solana-mainnet" : "solana-devnet",
    signature: sig,
    mintedAt: new Date().toISOString(),
  };
}

/** Truncate to a UTF-8 byte budget without splitting a multi-byte char. */
function fitBytes(s: string, max: number): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= max) return s;
  return new TextDecoder().decode(bytes.slice(0, max)).replace(/�+$/, "");
}

// Deterministic base58-looking id derived from the trip id (stable across
// re-renders, obviously non-transferable off the demo ledger).
function mockAssetId(tripId: string): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let h = 0x811c9dc5;
  const seedStr = `cnft:${tripId}`;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = "";
  let x = h;
  for (let i = 0; i < 44; i++) {
    x = Math.imul(x, 0x01000193) + i;
    out += alphabet[(x >>> 8) % alphabet.length];
  }
  return out;
}
