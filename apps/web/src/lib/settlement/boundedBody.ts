export class BodyTooLarge extends Error {}

/** Enforce the actual streamed size before parsing, even without Content-Length. */
export async function readBoundedBody(source: Pick<Request, "body" | "headers">, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(source.headers.get("content-length")) > limit) throw new BodyTooLarge("Body too large");
  if (!source.body) return new Uint8Array();
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLarge("Body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
