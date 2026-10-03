import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTENT_SCRIPT_MESSAGES } from "../messageGate";

// Content scripts run on arbitrary websites and share this extension's id, so
// the background's `sender.id === browser.runtime.id` check does not tell a
// content script apart from the popup. What keeps a hostile page away from the
// privileged handlers (RAMP_CHECKOUT, STEP_UP_SEND/VERIFY, LOGOUT, ...) is that
// no content script forwards a page-chosen message type. Pinned here: every
// sendMessage in a content script uses a literal type from this short list.
// The worker enforces the same list at runtime (lib/messageGate.ts), for the
// case source cannot cover: a compromised renderer.

const ENTRY = join(__dirname, "..", "..", "entrypoints");
const ALLOWED = CONTENT_SCRIPT_MESSAGES;

const contentScripts = readdirSync(ENTRY).filter((f) => f.endsWith(".content.ts"));

describe("content scripts cannot relay privileged messages", () => {
  it("found the content scripts", () => {
    expect(contentScripts.length).toBeGreaterThan(3);
  });

  it.each(contentScripts)("%s sends only fixed, unprivileged message types", (file) => {
    const src = readFileSync(join(ENTRY, file), "utf8");
    const sends = [...src.matchAll(/sendMessage\s*\(\s*([^)]*)/g)].map((m) => m[1]);
    for (const arg of sends) {
      const literal = /^\{\s*type:\s*"([A-Z0-9_]+)"/.exec(arg.trim());
      expect(literal, `${file}: sendMessage argument is not a literal-typed object: ${arg.slice(0, 80)}`).not.toBeNull();
      expect(ALLOWED.has(literal![1]), `${file}: sends ${literal![1]}`).toBe(true);
    }
  });
});
