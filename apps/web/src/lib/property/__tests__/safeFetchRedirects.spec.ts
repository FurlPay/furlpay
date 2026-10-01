import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// safeFetch end to end with DNS and the socket layer controlled: redirects into
// private space, redirect chains, DNS rebinding, mixed DNS answers.

const answers = new Map<string, { address: string; family: number }[][]>();
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    const queue = answers.get(host);
    if (!queue?.length) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    // Each lookup consumes the next answer: a rebinding server changes its reply.
    return queue.length > 1 ? queue.shift()! : queue[0];
  }),
}));

import { safeFetch } from "../safeFetch";

const pub = (a: string) => [{ address: a, family: a.includes(":") ? 6 : 4 }];
type Transport = NonNullable<Parameters<typeof safeFetch>[1]>["transport"];

function transport(routes: Record<string, () => Response>) {
  const calls: { url: string; address: string }[] = [];
  const t: Transport = async (url, address) => {
    calls.push({ url: url.toString(), address });
    const r = routes[url.toString()];
    return r ? r() : new Response("ok", { status: 200 });
  };
  return { t, calls };
}
const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });

beforeEach(() => answers.clear());
afterEach(() => vi.clearAllMocks());

describe("direct targets", () => {
  it.each([
    "http://127.0.0.1/",
    "http://localhost/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://metadata.google.internal/",
  ])("refuses %s before any connection", async (url) => {
    const { t, calls } = transport({});
    const r = await safeFetch(url, { transport: t });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("a name resolving to ONE private address among public ones is refused", async () => {
    answers.set("mixed.test", [[{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }]]);
    const { t, calls } = transport({});
    const r = await safeFetch("http://mixed.test/", { transport: t });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("DNS rebinding", () => {
  it("the socket goes to the address that was validated, whatever DNS says next", async () => {
    // First answer public, every later answer the metadata service.
    answers.set("rebind.test", [pub("93.184.216.34"), pub("169.254.169.254")]);
    const { t, calls } = transport({});
    const r = await safeFetch("http://rebind.test/x", { transport: t });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([{ url: "http://rebind.test/x", address: "93.184.216.34" }]);
  });
});

describe("redirects are re-validated hop by hop", () => {
  it("a public URL redirecting to the metadata service is refused at the hop", async () => {
    answers.set("public.test", [pub("93.184.216.34")]);
    const { t, calls } = transport({ "http://public.test/": redirect("http://169.254.169.254/latest/meta-data/iam/") });
    const r = await safeFetch("http://public.test/", { transport: t });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("private_address");
    expect(calls).toHaveLength(1); // the private hop never connects
  });

  it.each(["http://[::ffff:7f00:1]/", "http://localhost:8080/admin", "http://internal.corp.internal/"])("…or to %s", async (to) => {
    answers.set("public.test", [pub("93.184.216.34")]);
    const { t } = transport({ "http://public.test/": redirect(to) });
    expect((await safeFetch("http://public.test/", { transport: t })).ok).toBe(false);
  });

  it("a redirect to a name that resolves privately is refused", async () => {
    answers.set("public.test", [pub("93.184.216.34")]);
    answers.set("evil.test", [pub("192.168.0.10")]);
    const { t } = transport({ "http://public.test/": redirect("http://evil.test/") });
    expect((await safeFetch("http://public.test/", { transport: t })).ok).toBe(false);
  });

  it("chains are capped (MAX_REDIRECTS = 3)", async () => {
    for (const h of ["a.test", "b.test", "c.test", "d.test", "e.test"]) answers.set(h, [pub("93.184.216.34")]);
    const { t } = transport({
      "http://a.test/": redirect("http://b.test/"),
      "http://b.test/": redirect("http://c.test/"),
      "http://c.test/": redirect("http://d.test/"),
      "http://d.test/": redirect("http://e.test/"),
    });
    const r = await safeFetch("http://a.test/", { transport: t });
    expect(r.ok === false && r.reason).toBe("too_many_redirects");
  });

  it("non-http schemes in a redirect are refused", async () => {
    answers.set("public.test", [pub("93.184.216.34")]);
    const { t } = transport({ "http://public.test/": redirect("file:///etc/passwd") });
    const r = await safeFetch("http://public.test/", { transport: t });
    expect(r.ok === false && r.reason).toBe("bad_scheme");
  });
});
