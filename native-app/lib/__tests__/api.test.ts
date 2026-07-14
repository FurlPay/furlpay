import { api, ApiError } from "../api";

// SecureStore is auto-mocked by jest-expo (getToken -> null), so requests are
// anonymous here; we mock fetch to assert correlation-id behavior.
describe("api client — correlation id", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("sends X-Correlation-Id and captures the server's echoed id on error", async () => {
    let sentCid: string | undefined;
    global.fetch = (async (_url: string, init: any) => {
      sentCid = init.headers["X-Correlation-Id"];
      return {
        ok: false,
        status: 400,
        headers: { get: (h: string) => (h.toLowerCase() === "x-correlation-id" ? "server-echoed-id" : null) },
        json: async () => ({ error: "bad" }),
      };
    }) as unknown as typeof fetch;

    await expect(api("/x", { method: "POST", anonymous: true })).rejects.toMatchObject({
      correlationId: "server-echoed-id",
    });
    expect(typeof sentCid).toBe("string");
    expect((sentCid ?? "").length).toBeGreaterThan(10);
  });

  it("falls back to the client-generated id when the server does not echo", async () => {
    global.fetch = (async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => null,
    })) as unknown as typeof fetch;

    try {
      await api("/x", { anonymous: true });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).correlationId).toMatch(/[0-9a-f-]{36}/);
    }
  });
});
