import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";
import { BodyTooLarge, readBoundedBody } from "@/lib/settlement/boundedBody";

// ---------------------------------------------------------------------------
// Shared request-body validation for API routes: size cap → JSON parse → Zod.
// Returns either the parsed data or a ready-to-return 4xx response, so routes
// stay one-liner clean:
//
//   const body = await validateBody(req, Schema);
//   if (body instanceof NextResponse) return body;
//   // body is typed as z.infer<typeof Schema> from here
//
// The size cap defends serverless memory: JSON.parse on a huge body is the
// cheapest way to burn a function. Content-Length is checked first (cheap),
// then the body is read as a stream and abandoned the moment it passes the
// cap. The previous version called req.text() and measured afterwards, so a
// chunked upload with no Content-Length was buffered in full before the
// check ran (audit F-10 / F-38).
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 100 * 1024; // 100KB — far above any legitimate payload

export async function validateBody<T>(
  req: Request,
  schema: ZodSchema<T>,
  { maxBytes = MAX_BODY_BYTES }: { maxBytes?: number } = {}
): Promise<T | NextResponse> {
  let raw: unknown;
  try {
    raw = await readJsonBody(req, { maxBytes });
  } catch (e) {
    if (e instanceof BodyTooLarge) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    if (e instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    return NextResponse.json({ error: "Unreadable request body" }, { status: 400 });
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        issues: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }
  return result.data;
}

/**
 * Drop-in for `await req.json()` with a real size bound.
 *
 * `req.json()` buffers the whole body, whatever its size, before anything can
 * look at it; the middleware's Content-Length check cannot stop a chunked
 * upload that declares no length. This reads the stream, stops at `maxBytes`,
 * and only then parses. Like `req.json()` it rejects on bad input — with
 * `BodyTooLarge` when over the cap and `SyntaxError` when the JSON is invalid —
 * so existing `.catch(() => null)` call sites keep their meaning. An empty body
 * is a SyntaxError, as it is for `req.json()`.
 */
export async function readJsonBody(
  req: Pick<Request, "body" | "headers">,
  { maxBytes = MAX_BODY_BYTES }: { maxBytes?: number } = {}
): Promise<any> {
  const bytes = await readBoundedBody(req, maxBytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export { BodyTooLarge, MAX_BODY_BYTES };

/**
 * Drop-in for `await req.text()` with the same size bound — for handlers that
 * need the exact raw text (webhook HMACs are computed over it). Decodes UTF-8
 * the same way `req.text()` does, so a signature over the text still verifies.
 * Rejects with `BodyTooLarge` past `maxBytes`.
 */
export async function readTextBody(
  req: Pick<Request, "body" | "headers">,
  { maxBytes = MAX_BODY_BYTES }: { maxBytes?: number } = {}
): Promise<string> {
  return new TextDecoder().decode(await readBoundedBody(req, maxBytes));
}

/**
 * Drop-in for `await req.formData()` with the same size bound. The capped bytes
 * are handed to the platform's own FormData parser with the request's
 * Content-Type, so urlencoded and multipart bodies parse exactly as before.
 */
export async function readFormBody(
  req: Pick<Request, "body" | "headers">,
  { maxBytes = MAX_BODY_BYTES }: { maxBytes?: number } = {}
): Promise<FormData> {
  const bytes = await readBoundedBody(req, maxBytes);
  const contentType = req.headers.get("content-type") ?? "application/x-www-form-urlencoded";
  return new Response(bytes, { headers: { "content-type": contentType } }).formData();
}
