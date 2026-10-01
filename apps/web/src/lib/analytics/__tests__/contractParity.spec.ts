import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { CLIENT_EVENTS, CLIENT_PLATFORMS, SERVER_ONLY_EVENTS } from "../contract";

// One contract, four copies: this file, the database CHECK (0028), the
// extension's event list and the mobile sink's mapping. Any drift fails here.

const ROOT = join(__dirname, "..", "..", "..", "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const strings = (src: string) => [...src.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe("database CHECK (0028) == contract", () => {
  const sql = read("supabase", "migrations", "0028_cross_platform_analytics.sql");
  const clientBlock = sql.slice(sql.indexOf("(source = 'client' and event_name in ("), sql.indexOf("error_occurred')))") + "error_occurred".length + 2);
  it("client event names match exactly", () => {
    expect(strings(clientBlock).filter((s) => s !== "client").sort()).toEqual([...CLIENT_EVENTS].sort());
  });
  it("no server-only event is client-insertable", () => {
    for (const e of SERVER_ONLY_EVENTS) expect(strings(clientBlock)).not.toContain(e);
  });
  it("platforms match", () => {
    const m = /analytics_events_platform_check check \(platform in \(([^)]*)\)/.exec(sql)![1];
    expect(strings(m).sort()).toEqual([...CLIENT_PLATFORMS, "api"].sort());
  });
});

describe("clients only send contract events", () => {
  it("extension", () => {
    const src = read("apps", "extension", "lib", "analytics.ts");
    const list = strings(src.slice(src.indexOf("EXTENSION_EVENTS = ["), src.indexOf("] as const")).replace(/"/g, "'"));
    expect(list.length).toBeGreaterThan(3);
    for (const e of list) expect(CLIENT_EVENTS as readonly string[]).toContain(e);
  });

  it("android / ios sink", () => {
    const src = read("native-app", "lib", "analytics", "furlpaySink.ts");
    const sent = [...src.matchAll(/eventName: "([a-z_]+)"/g)].map((m) => m[1]);
    expect(sent.length).toBeGreaterThan(3);
    for (const e of sent) expect(CLIENT_EVENTS as readonly string[]).toContain(e);
  });

  it("web client is typed against the contract (ClientEventName)", () => {
    expect(read("apps", "web", "src", "lib", "analytics", "client.ts")).toMatch(/eventName: ClientEventName/);
  });
});
