import { NextRequest } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { liveSnapshot } from "@/lib/onchain/live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/onchain/stream — PUBLIC Server-Sent Events for /onchain.
//
// It carries NO data, only change notifications: `event: change` with the
// newest ingested event id and pipeline state whenever either moves, and a
// `: ping` heartbeat every 15 s. The page then refetches /api/onchain/live,
// so widgets update incrementally without the stream ever carrying a row.
//
// Cost is bounded: every connection on an instance reads the same 2-second
// shared snapshot (lib/onchain/live), so N viewers cost one query per 2 s, not
// N. Connections close after 50 s (below the function ceiling); EventSource
// reconnects on its own (retry: 3000).
const TICK_MS = 2_000;
const LIFETIME_MS = 50_000;

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onchain-stream", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closer: ReturnType<typeof setTimeout> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let last = "";
      let sinceBeat = 0;
      let closed = false;
      const send = (s: string) => {
        if (!closed) controller.enqueue(enc.encode(s));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        clearTimeout(closer);
        try {
          controller.close();
        } catch {}
      };
      send("retry: 3000\n\n");
      const tick = async () => {
        try {
          const s = await liveSnapshot(false);
          const sig = `${s.latestId ?? 0}|${s.state}`;
          if (sig !== last) {
            last = sig;
            send(`event: change\ndata: ${JSON.stringify({ latestId: s.latestId, state: s.state, at: s.generatedAt })}\n\n`);
            sinceBeat = 0;
            return;
          }
        } catch {
          send(`event: change\ndata: ${JSON.stringify({ latestId: null, state: "offline", at: new Date().toISOString() })}\n\n`);
        }
        sinceBeat += TICK_MS;
        if (sinceBeat >= 15_000) {
          sinceBeat = 0;
          send(": ping\n\n");
        }
      };
      void tick();
      timer = setInterval(() => void tick(), TICK_MS);
      closer = setTimeout(close, LIFETIME_MS);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      clearInterval(timer);
      clearTimeout(closer);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
