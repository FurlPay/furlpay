import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The x402 detection log is a list of pages the user visited (each URL that
// answered HTTP 402). It must stay in session storage — memory-only, cleared
// when the browser closes — never in storage.local, which persists on disk.
const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("x402 detection log storage", () => {
  const sources = ["entrypoints/background.ts", "entrypoints/popup/components/SettingsTab.tsx"].map((p) => [p, read(p)] as const);

  it("is never written to or read from storage.local", () => {
    for (const [p, src] of sources) {
      expect(src, p).not.toMatch(/storage\.local\.(get|set)\(\s*(\{\s*)?["']?x402Log/);
      expect(src, p).not.toMatch(/storage\.local\.set\(\{\s*x402Log/);
    }
  });

  it("lives in storage.session, and the legacy local copy is removed on install/update", () => {
    const bg = sources[0][1];
    expect(bg).toMatch(/storage\.session\.set\(\{\s*x402Log/);
    expect(bg).toMatch(/storage\.local\.remove\("x402Log"\)/);
  });
});
