import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";

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
// then the actual text length (Content-Length can lie or be absent).
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 100 * 1024; // 100KB — far above any legitimate payload

export async function validateBody<T>(
  req: Request,
  schema: ZodSchema<T>,
  { maxBytes = MAX_BODY_BYTES }: { maxBytes?: number } = {}
): Promise<T | NextResponse> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return NextResponse.json({ error: "Unreadable request body" }, { status: 400 });
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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
