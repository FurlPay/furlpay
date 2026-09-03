import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { readChallenge } from "@/lib/discordVerify/challenge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/og/captcha/[id] — the picture half of the verification captcha.
//
// ── WHY THIS ROUTE IS PUBLIC ───────────────────────────────────────────────
//
// Discord renders an embed image by FETCHING THE URL ITSELF from its own
// proxy, with no Authorization header and no cookie. So this cannot be
// authenticated, and the id is the only thing standing between a stranger and
// the picture.
//
// That is acceptable because of what the id is and what the picture is worth:
// 128 bits of randomness, valid for five minutes, bound to one member, good for
// at most three attempts, and destroyed the moment it is used. Someone who
// guesses an id sees a distorted five-character code they cannot submit,
// because submitting requires being the member it was issued to.
//
// It still gets a rate limit. The route rasterises a PNG per request, which is
// the expensive kind of public endpoint, and the middleware baseline only
// throttles mutating methods.
//
// ── WHY THE DISTORTION IS THIS AND NOT MORE ────────────────────────────────
//
// Satori has no filters, no canvas and no per-glyph transform on a text node,
// so each character is its own rotated, offset, differently-sized element, over
// a field of distractor strokes. That defeats naive template matching and the
// "read the alt text" class of bot. It will not defeat a real OCR pipeline —
// see the note in challenge.ts about what this is actually for. Pushing the
// distortion further would start costing real members their first attempt,
// which is a worse trade than it looks.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const limited = await rateLimitOr429(req, "og.captcha", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const { id } = await props.params;
  const challenge = await readChallenge(id);

  // An expired or unknown id renders a neutral card rather than a 404, so a
  // member whose challenge timed out sees "expired" instead of a broken image.
  const code = challenge?.code ?? null;

  const W = 420;
  const H = 160;

  // Deterministic per-challenge jitter: the same id always renders the same
  // image, so Discord's proxy cache never disagrees with what we issued.
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const chars = (code ?? "").split("");
  const slot = chars.length > 0 ? (W - 80) / chars.length : 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          position: "relative",
          alignItems: "center",
          justifyContent: "center",
          background: "#0B0F14",
          border: "2px solid #00E599",
          borderRadius: 14,
        }}
      >
        {/* Distractor strokes, behind the glyphs. */}
        {Array.from({ length: 9 }).map((_, i) => {
          const y = 20 + rand() * (H - 40);
          return (
            <div
              key={`line-${i}`}
              style={{
                position: "absolute",
                display: "flex",
                left: 10 + rand() * 40,
                top: y,
                width: W - 40 - rand() * 60,
                height: 2,
                background: i % 2 === 0 ? "rgba(0,229,153,0.30)" : "rgba(255,255,255,0.16)",
                transform: `rotate(${(rand() * 24 - 12).toFixed(2)}deg)`,
              }}
            />
          );
        })}

        {code === null ? (
          <div style={{ display: "flex", color: "#8A94A6", fontSize: 24, fontWeight: 600 }}>
            This challenge has expired
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            {chars.map((c, i) => (
              <div
                key={`c-${i}`}
                style={{
                  display: "flex",
                  width: slot,
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 52 + Math.round(rand() * 16),
                  fontWeight: 800,
                  color: i % 2 === 0 ? "#FFFFFF" : "#00E599",
                  transform: `rotate(${(rand() * 40 - 20).toFixed(2)}deg) translateY(${(rand() * 18 - 9).toFixed(
                    2
                  )}px)`,
                }}
              >
                {c}
              </div>
            ))}
          </div>
        )}

        {/* Foreground speckle, over the glyphs. */}
        {Array.from({ length: 26 }).map((_, i) => (
          <div
            key={`dot-${i}`}
            style={{
              position: "absolute",
              display: "flex",
              left: rand() * W,
              top: rand() * H,
              width: 3,
              height: 3,
              borderRadius: 2,
              background: "rgba(255,255,255,0.35)",
            }}
          />
        ))}
      </div>
    ),
    {
      width: W,
      height: H,
      headers: {
        // Never cached by a shared cache: the image is per-challenge and
        // short-lived, and a cached captcha is a reused captcha.
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
