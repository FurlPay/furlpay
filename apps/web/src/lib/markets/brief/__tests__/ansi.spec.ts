import { describe, it, expect } from "vitest";
import {
  ansiBlock,
  bold,
  cell,
  color,
  directionColor,
  fitsMobile,
  MOBILE_COLUMNS,
  pad,
  padLeft,
  stripAnsi,
  visibleWidth,
} from "../ansi";

// ---------------------------------------------------------------------------
// ANSI colour and column alignment.
//
// The bug this whole module exists to prevent: `padEnd` counts the invisible
// escape bytes as visible columns, so every coloured row ends up short by a
// different amount and the table looks corrupted in exactly the way that is
// impossible to diagnose from a screenshot.
// ---------------------------------------------------------------------------

/** Explicit escape, never a pasted control byte — see ansi.ts. */
const ESC = "\u001b";

describe("colour codes", () => {
  it("emits only the SGR subset Discord honours", () => {
    // 256-colour and 24-bit escapes are NOT rendered by Discord — they print as
    // literal garbage in the middle of the table.
    const s = color("x", "green");
    expect(s).toBe(`${ESC}[0;32mx${ESC}[0m`);
    expect(s).not.toContain("38;5;");
    expect(s).not.toContain("38;2;");
  });

  it("supports bold as a separate concern from colour", () => {
    expect(color("x", "red", true)).toBe(`${ESC}[1;31mx${ESC}[0m`);
    expect(bold("x")).toBe(`${ESC}[1mx${ESC}[0m`);
  });

  it("always resets, so colour cannot bleed into the next row", () => {
    expect(color("x", "cyan").endsWith(`${ESC}[0m`)).toBe(true);
  });
});

describe("visibleWidth / stripAnsi", () => {
  it("measures what the reader sees, not what is in the payload", () => {
    const green = color("OKTA", "green");
    expect(green.length).toBeGreaterThan(4);
    expect(visibleWidth(green)).toBe(4);
    expect(stripAnsi(green)).toBe("OKTA");
  });

  it("leaves uncoloured text alone", () => {
    expect(visibleWidth("plain")).toBe(5);
    expect(stripAnsi("plain")).toBe("plain");
  });
});

describe("pad / padLeft — the alignment bug", () => {
  it("pads a coloured string to its VISIBLE width", () => {
    // This is the assertion that fails with a naive padEnd.
    const padded = pad(color("AB", "green"), 6);
    expect(visibleWidth(padded)).toBe(6);
  });

  it("right-aligns numeric columns so decimal points line up", () => {
    expect(padLeft("1.5", 8)).toBe("     1.5");
    expect(visibleWidth(padLeft(color("+22.58%", "green"), 9))).toBe(9);
  });

  it("truncates rather than overflowing a column", () => {
    expect(visibleWidth(pad("ABCDEFGHIJ", 5))).toBe(5);
    expect(pad("ABCDEFGHIJ", 5)).toBe("ABCD…");
    expect(padLeft("ABCDEFGHIJ", 5)).toBe("ABCD…");
  });

  it("handles a width of 1 and 0 without producing a stray ellipsis", () => {
    expect(pad("ABC", 1)).toBe("A");
    expect(pad("ABC", 0)).toBe("");
  });
});

describe("cell — pads first, colours second", () => {
  it("produces a cell of exactly the requested visible width", () => {
    for (const w of [4, 6, 8, 12]) {
      expect(visibleWidth(cell("NVDA", w, { fg: "green" }))).toBe(w);
      expect(visibleWidth(cell("+1.23%", w, { align: "right", fg: "red" }))).toBe(w);
    }
  });

  it("keeps every row of a table the same visible width regardless of colour", () => {
    // The real failure mode: green rows and red rows misaligning against each
    // other because they carry different escape lengths.
    const rows = [
      [cell("AAA", 6), cell("+1.00%", 8, { align: "right", fg: "green" })].join(" "),
      [cell("BBBBB", 6), cell("-12.34%", 8, { align: "right", fg: "red" })].join(" "),
      [cell("CC", 6), cell("—", 8, { align: "right", fg: "grey" })].join(" "),
    ];
    const widths = rows.map(visibleWidth);
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBe(15);
  });

  it("still aligns when no colour is applied at all", () => {
    expect(visibleWidth(cell("X", 5))).toBe(5);
  });
});

describe("directionColor", () => {
  it("follows the convention every reader already has", () => {
    expect(directionColor(1)).toBe("green");
    expect(directionColor(-1)).toBe("red");
    expect(directionColor(0)).toBe("grey");
    expect(directionColor(null)).toBe("grey");
    expect(directionColor(Number.NaN)).toBe("grey");
  });
});

describe("ansiBlock", () => {
  it("fences rows so Discord colourises them", () => {
    expect(ansiBlock(["a", "b"])).toBe("```ansi\na\nb\n```");
  });

  it("returns empty for no rows, so a caller can drop the section", () => {
    // An empty fenced block renders as an empty grey box for no reason.
    expect(ansiBlock([])).toBe("");
  });
});

describe("fitsMobile — the width budget is pinned", () => {
  it("accepts a table inside the phone column budget", () => {
    expect(fitsMobile([7, 8, 7])).toBe(true);
  });

  it("rejects a table that would wrap", () => {
    expect(fitsMobile([20, 20, 20])).toBe(false);
  });

  it("counts the gaps between columns, not just the columns", () => {
    // Exactly at the budget with gaps included.
    expect(fitsMobile([10, 10, 10], 2)).toBe(true);
    expect(MOBILE_COLUMNS).toBe(32);
  });
});
