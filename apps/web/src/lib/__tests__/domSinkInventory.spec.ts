import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// The complete inventory of HTML-injection sinks in the web client.
//
// WHY AN INVENTORY AND NOT A SCANNER.
//
// A sweep of this codebase found four places where a string can become markup or
// executable code, and all four are currently safe:
//
//   JsonLd.tsx            JSON.stringify with `<` → <, so a value containing
//                         "</script>" cannot break out of the tag.
//   docs/Highlight.tsx    Shiki HTML-escapes its input, and `lang` is checked
//                         against a SUPPORTED allowlist before use.
//   docs/Mermaid.tsx      mermaid runs with securityLevel "strict" on chart
//                         strings that are author-written literals.
//   PersonaKycButton.tsx  A dynamically-created <script> whose src is a module
//                         constant, not data.
//
// Every one of those is safe because of a property of its INPUT — "author
// content", "a constant", "allowlisted" — and none of those properties is
// enforced by anything. They are conventions, and the audit's finding that the
// client-side sweep was outstanding is exactly the observation that a convention
// verified once is not a control.
//
// So this test does not try to decide whether a sink is safe; static analysis
// cannot answer that. It pins the LIST. A new sink fails here, at the moment it
// is written, and whoever adds it has to come and state why it is safe. That is a
// review trigger, which is the honest thing a test can provide here.
//
// It also asserts the specific properties the four current sinks depend on, so a
// change that quietly removes the escaping or the allowlist fails too.
// ---------------------------------------------------------------------------

const SRC = join(__dirname, "..", "..");

/** Files that may contain an HTML-injection sink, and why each is acceptable. */
const ALLOWED_SINKS: Record<string, string> = {
  "components/JsonLd.tsx":
    "JSON-LD only; escapes `<` to \\u003c so a value cannot close the script tag.",
  "components/docs/Highlight.tsx":
    "Shiki output; Shiki HTML-escapes code and `lang` is allowlisted before use.",
  "components/docs/Mermaid.tsx":
    "Mermaid SVG with securityLevel 'strict' over author-written chart literals.",
  "components/PersonaKycButton.tsx":
    "Dynamic <script> whose src is a module constant, never data.",
};

const SINK_PATTERNS: Array<[string, RegExp]> = [
  ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
  ["innerHTML", /\.innerHTML\s*=/],
  ["outerHTML", /\.outerHTML\s*=/],
  ["insertAdjacentHTML", /insertAdjacentHTML\s*\(/],
  ["document.write", /document\s*\.\s*write(ln)?\s*\(/],
  ["eval", /(?<![\w.])eval\s*\(/],
  ["new Function", /new\s+Function\s*\(/],
  ["dynamic script element", /createElement\s*\(\s*["'`]script["'`]\s*\)/],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.spec\.|\.test\./.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Source with comments removed.
 *
 * Comments have to go, because the prose in this very file names every sink it
 * forbids and a naive scan would flag itself. But the stripper has to TRACK
 * STRING STATE: a first attempt cut each line at the first `//`, which truncated
 * `const PERSONA_SRC = "https://cdn..."` at the scheme separator and made the
 * constant look undefined. Same class of bug as a regex that matches its own
 * documentation — the checker reporting on the checker.
 */
function code(text: string): string {
  let out = "";
  let quote: string | null = null;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      // Line comment — skip to the newline, keeping the newline itself so line
      // numbers and line-oriented assertions still line up.
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

const FILES = walk(SRC);

describe("DOM injection sink inventory", () => {
  it("finds a realistic number of source files", () => {
    // Guards the guard. A wrong path makes every assertion below vacuous: zero
    // files scanned, no sinks found, green suite.
    expect(FILES.length, "the walker found almost nothing — check SRC").toBeGreaterThan(200);
  });

  it("no file outside the reviewed list contains an HTML-injection sink", () => {
    const found: string[] = [];
    for (const file of FILES) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");
      if (rel in ALLOWED_SINKS) continue;
      const text = code(readFileSync(file, "utf8"));
      for (const [name, pattern] of SINK_PATTERNS) {
        if (pattern.test(text)) found.push(`${rel}: ${name}`);
      }
    }
    expect(
      found,
      "New HTML-injection sink(s). Each needs a reviewer to establish that its " +
        "input cannot carry attacker-controlled markup — customer names, " +
        "transaction descriptions, support ticket text, agency names and " +
        "emergency declarations are all attacker-influenced. Once reviewed, add " +
        "the file to ALLOWED_SINKS with the reason."
    ).toEqual([]);
  });

  it("every allowlisted file still exists and still contains a sink", () => {
    // Otherwise the allowlist rots into a list of exemptions for files that have
    // been deleted or cleaned up, and it stops describing reality.
    for (const [rel, reason] of Object.entries(ALLOWED_SINKS)) {
      const text = code(readFileSync(join(SRC, rel), "utf8"));
      const hasSink = SINK_PATTERNS.some(([, p]) => p.test(text));
      expect(hasSink, `${rel} is allowlisted but no longer has a sink — remove the entry`).toBe(true);
      expect(reason.length, `${rel} has no stated reason`).toBeGreaterThan(20);
    }
  });
});

describe("the properties the current sinks depend on", () => {
  it("JsonLd escapes the character that closes a script tag", () => {
    // Without this, a value containing "</script>" in any JSON-LD field — a
    // product name, a city, an FAQ answer — breaks out of the tag and executes.
    // JSON.stringify alone does NOT escape `<`.
    const text = readFileSync(join(SRC, "components/JsonLd.tsx"), "utf8");
    expect(text).toMatch(/replace\(\s*\/<\/g\s*,\s*["'`]\\\\u003c["'`]\s*\)/);
  });

  it("Highlight checks the language against an allowlist before highlighting", () => {
    // `lang` reaches Shiki. An unvalidated value is at minimum a crash and at
    // worst a path into loading a grammar that was never intended.
    const text = code(readFileSync(join(SRC, "components/docs/Highlight.tsx"), "utf8"));
    expect(text).toMatch(/SUPPORTED\.has\(/);
    // And the unsupported case must bail rather than fall through to the sink.
    expect(text).toMatch(/if \(!SUPPORTED\.has\([^)]*\)\) return/);
  });

  it("Mermaid runs in strict security mode", () => {
    // Mermaid has a history of XSS through label content. `strict` is what stops
    // the rendered SVG carrying script, and it is the single line this sink's
    // safety rests on.
    const text = code(readFileSync(join(SRC, "components/docs/Mermaid.tsx"), "utf8"));
    expect(text).toMatch(/securityLevel:\s*["'`]strict["'`]/);
    expect(text).not.toMatch(/securityLevel:\s*["'`](loose|antiscript)["'`]/);
  });

  it("the dynamic script src is a constant, not an expression", () => {
    // `script.src = someVariable` where the variable is data is a script-injection
    // primitive. This must stay a module constant.
    const text = code(readFileSync(join(SRC, "components/PersonaKycButton.tsx"), "utf8"));
    expect(text).toMatch(/script\.src\s*=\s*PERSONA_SRC/);
    expect(text).toMatch(/const PERSONA_SRC\s*=\s*["'`]https:\/\//);
  });
});
