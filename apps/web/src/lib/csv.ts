// ---------------------------------------------------------------------------
// CSV cells for files a person opens in Excel or Sheets.
//
// RFC 4180 quoting, plus formula-injection defence: a cell beginning with
// = + - @ (or a tab/CR) is executed as a formula by spreadsheet apps, so a
// transaction titled `=HYPERLINK("https://evil", "click")` would run on open.
// Prefixing a quote neutralises it without altering the stored data.
// ---------------------------------------------------------------------------

export function csvCell(value: string | number | boolean | null | undefined): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Header row + rows, CRLF-separated (RFC 4180). */
export function csvDocument(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const line = (cells: readonly unknown[]) => cells.map((c) => csvCell(c as string)).join(",");
  return [line(header), ...rows.map(line)].join("\r\n") + "\r\n";
}
