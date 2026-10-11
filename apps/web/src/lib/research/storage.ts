// ---------------------------------------------------------------------------
// Private PDF storage: Supabase Storage, which production already runs, used
// through its REST API (no new SDK).
//
// The bucket must be PRIVATE. Nothing here ever returns a permanent object
// URL; the only output is a signed URL that expires in SIGNED_URL_TTL_SECONDS.
// A missing configuration is reported as unavailable, never papered over with
// a public link.
//
// Credentials are resolved through lib/dataPlane.ts, like every other backend:
// a preview deployment without its own data plane gets none, so it cannot mint
// signed URLs for the production bucket.
// ---------------------------------------------------------------------------

import { resolveDataPlane } from "@/lib/dataPlane";

export const SIGNED_URL_TTL_SECONDS = 60;
const SAFE_KEY = /^[a-z0-9][a-z0-9._/-]{0,200}\.pdf$/;

export type SignResult = { ok: true; url: string } | { ok: false; reason: "not_configured" | "unavailable" };

export function storageConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const plane = resolveDataPlane(env);
  return !!(plane.supabaseUrl && plane.supabaseKey && env.RESEARCH_PDF_BUCKET);
}

/**
 * A 60-second signed URL for one object. `objectKey` comes from the report
 * record in the repository, never from a request; the shape check is defence
 * in depth against a bad record (no "..", no leading slash, .pdf only).
 */
export async function signedPdfUrl(objectKey: string, env: NodeJS.ProcessEnv = process.env): Promise<SignResult> {
  if (!storageConfigured(env)) return { ok: false, reason: "not_configured" };
  if (!SAFE_KEY.test(objectKey) || objectKey.includes("..")) return { ok: false, reason: "unavailable" };
  const plane = resolveDataPlane(env);
  const base = plane.supabaseUrl!.replace(/\/$/, "");
  const bucket = encodeURIComponent(env.RESEARCH_PDF_BUCKET!);
  const path = objectKey.split("/").map(encodeURIComponent).join("/");
  try {
    const res = await fetch(`${base}/storage/v1/object/sign/${bucket}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${plane.supabaseKey}`,
        apikey: plane.supabaseKey!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const j = (await res.json()) as { signedURL?: string };
    if (!j.signedURL || !j.signedURL.startsWith("/")) return { ok: false, reason: "unavailable" };
    return { ok: true, url: `${base}/storage/v1${j.signedURL}` };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
