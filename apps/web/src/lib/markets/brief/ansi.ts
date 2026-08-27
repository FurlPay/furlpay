// ---------------------------------------------------------------------------
// Discord ANSI colour, and column alignment that survives it.
//
// Discord renders a fenced block tagged ```ansi with a subset of SGR escapes.
// It is the only way to get PER-ROW colour into a message — an embed carries
// exactly one colour, on its left border, so without this a table of gainers and
// losers is one uniform shade and the reader has to parse the sign of every
// number themselves.
//
// THE SUPPORTED SUBSET IS SMALL, and going outside it does not error — it prints
// the escape as literal text in the middle of the table. Only these are used:
//
//     0 reset   1 bold   4 underline
//     30-37 foreground        40-47 background
//
// No 256-colour, no 24-bit, no `\e[38;5;n`. Those are the ones that leak.
//
// THE BUG THIS FILE EXISTS TO PREVENT. `"OKTA".padEnd(8)` is correct.
// `green("OKTA").padEnd(8)` is not: the string now carries ~9 invisible
// characters, `padEnd` counts them, and the column is 9 short. Every row is
// misaligned by a different amount depending on which colour it got, and the
// table looks corrupted in exactly the way that is hardest to diagnose from a
// screenshot. `pad`/`padLeft` here measure VISIBLE width, and `cell()` composes
// the two in the only safe order: pad first, colour second.
//
// WIDTH IS THE OTHER HARD CONSTRAINT. A Discord code block wraps at roughly 32
// columns on a phone. `MOBILE_COLUMNS` is that budget, and the table builder
// refuses to exceed it rather than producing something that only looks right on
// a desktop.
//
// GRACEFUL DEGRADATION IS FREE. A client that does not colourise an `ansi` block
// renders it as a plain code block — still monospace, still aligned, just
// monochrome. Nothing here depends on the colour being applied.
// ---------------------------------------------------------------------------

/** Written as an explicit escape sequence, never as a pasted control byte: a
 *  literal 0x1B in a source file is invisible in every diff and every editor,
 *  and survives only until someone's formatter strips it. */
const ESC = "\u001b";

/** The foreground codes Discord actually honours. */
export const FG = {
  grey: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  pink: 35,
  cyan: 36,
  white: 37,
} as const;

export type FgName = keyof typeof FG;

export const RESET = `${ESC}[0m`;

/** Wrap text in a foreground colour, optionally bold. */
export function color(text: string, name: FgName, bold = false): string {
  return `${ESC}[${bold ? "1;" : "0;"}${FG[name]}m${text}${RESET}`;
}

export function bold(text: string): string {
  return `${ESC}[1m${text}${RESET}`;
}

/** Strip every SGR escape, leaving what the reader actually sees. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

/** Visible width: what `padEnd` should have counted. */
export function visibleWidth(s: string): number {
  return stripAnsi(s).length;
}

/** Pad right to a visible width, truncating when the content is too long. */
export function pad(s: string, width: number): string {
  const w = visibleWidth(s);
  if (w === width) return s;
  if (w < width) return s + " ".repeat(width - w);
  // Too long. Truncation has to happen on the VISIBLE text, so this only
  // accepts uncoloured input — `cell()` guarantees that by padding first.
  const plain = stripAnsi(s);
  return width <= 1 ? plain.slice(0, width) : `${plain.slice(0, width - 1)}…`;
}

/** Pad left to a visible width — for numeric columns, which must right-align
 *  or the decimal points do not line up and the table stops being scannable. */
export function padLeft(s: string, width: number): string {
  const w = visibleWidth(s);
  if (w === width) return s;
  if (w < width) return " ".repeat(width - w) + s;
  const plain = stripAnsi(s);
  return width <= 1 ? plain.slice(0, width) : `${plain.slice(0, width - 1)}…`;
}

/**
 * One table cell: pad to width, THEN colour.
 *
 * The order is the whole point. Colouring first makes every padding
 * calculation downstream count invisible bytes as visible columns.
 */
export function cell(
  text: string,
  width: number,
  opts: { align?: "left" | "right"; fg?: FgName; bold?: boolean } = {}
): string {
  const padded = opts.align === "right" ? padLeft(text, width) : pad(text, width);
  return opts.fg ? color(padded, opts.fg, opts.bold) : opts.bold ? bold(padded) : padded;
}

/** The column budget before a Discord code block wraps on a phone. */
export const MOBILE_COLUMNS = 32;

/** Colour for a signed number: the convention every reader already has. */
export function directionColor(n: number | null | undefined): FgName {
  if (typeof n !== "number" || !Number.isFinite(n) || n === 0) return "grey";
  return n > 0 ? "green" : "red";
}

/**
 * Wrap rows in a Discord ```ansi fence.
 *
 * Returns an empty string for no rows, so a caller can drop the whole section
 * rather than posting an empty code block.
 */
export function ansiBlock(lines: string[]): string {
  if (lines.length === 0) return "";
  return ["```ansi", ...lines, "```"].join("\n");
}

/** The characters a fenced block costs on top of its content, for budgeting. */
export const FENCE_OVERHEAD = "```ansi\n\n```".length;

/**
 * Assert a set of column widths fits the mobile budget.
 *
 * Exported so a spec can pin it: a table that fits today and gains a column
 * tomorrow fails a test rather than silently wrapping in production.
 */
export function fitsMobile(widths: number[], gaps = widths.length - 1): boolean {
  return widths.reduce((a, b) => a + b, 0) + Math.max(0, gaps) <= MOBILE_COLUMNS;
}
