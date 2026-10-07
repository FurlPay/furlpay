// Pure parsing/validation for tokenized-assets CSV exports (no I/O). Used by
// import-rwa-snapshot.mjs and unit-tested in apps/web/src/lib/__tests__/rwaCsv.spec.ts.

export const HEADER = ["product_name", "token_symbol", "chain", "issuer_name", "asset_class", "asset_type", "market_cap_usd"];
const DEC = /^\d{1,22}(\.\d{1,30})?$/;

/** RFC 4180: quoted fields, doubled quotes, CRLF or LF; a BOM is ignored. */
export function parseCsv(text) {
  const t = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(f); rows.push(row); row = []; f = "";
    } else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/**
 * Plain decimal string for a market cap, or null. Exponent notation is
 * expanded EXACTLY by moving the decimal point in the digit string (no float
 * round-trip), then rounded half-up to the column's 8 decimals.
 */
export function normalizeMoney(raw) {
  const s = raw.trim();
  let int, frac;
  const exp = /^(\d+)(?:\.(\d+))?e([-+]?\d+)$/i.exec(s);
  if (exp) {
    const digits = exp[1] + (exp[2] ?? "");
    const point = exp[1].length + Number(exp[3]);
    if (point <= 0) { int = "0"; frac = "0".repeat(-point) + digits; }
    else if (point >= digits.length) { int = digits + "0".repeat(point - digits.length); frac = ""; }
    else { int = digits.slice(0, point); frac = digits.slice(point); }
  } else if (DEC.test(s)) {
    [int, frac = ""] = s.split(".");
  } else return null;
  int = int.replace(/^0+(?=\d)/, "") || "0";
  if (int.length > 22) return null;
  if (frac.length > 8) {
    // Round half-up at 8 decimals using integer string arithmetic.
    const up = Number(frac[8]) >= 5;
    let keep = BigInt(int + frac.slice(0, 8)) + (up ? 1n : 0n);
    const str = keep.toString().padStart(9, "0");
    int = str.slice(0, -8).replace(/^0+(?=\d)/, "") || "0";
    frac = str.slice(-8);
  }
  frac = frac.replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/**
 * Validate every row. Returns { rows, errors }. ANY error means the caller
 * must write nothing. Identity is (chain, product_name, token_symbol) — the
 * table's key within a snapshot — so a duplicate is an error, not a merge.
 */
export function validateRows(parsed, { asOf, source }) {
  const errors = [];
  const [head = [], ...body] = parsed;
  if (head.map((h) => h.trim()).join(",") !== HEADER.join(",")) {
    return { rows: [], errors: [`unexpected header: ${head.join(",")} (expected ${HEADER.join(",")})`] };
  }
  const seen = new Set();
  const rows = [];
  body.forEach((r, i) => {
    const line = i + 2;
    if (r.length !== HEADER.length) return errors.push(`line ${line}: ${r.length} columns, expected ${HEADER.length}`);
    const [product_name, token_symbol, chain, issuer_name, asset_class, asset_type, mcapRaw] = r.map((v) => v.trim());
    if (!product_name || product_name.length > 200) errors.push(`line ${line}: product_name`);
    if (token_symbol.length > 64) errors.push(`line ${line}: token_symbol too long`);
    if (!/^[a-z0-9_-]{2,32}$/.test(chain)) errors.push(`line ${line}: chain "${chain}"`);
    if (!issuer_name || issuer_name.length > 200) errors.push(`line ${line}: issuer_name`);
    if (!/^[a-z_]{2,40}$/.test(asset_class)) errors.push(`line ${line}: asset_class "${asset_class}"`);
    if (!/^[a-z0-9_]{2,60}$/.test(asset_type)) errors.push(`line ${line}: asset_type "${asset_type}"`);
    const mc = normalizeMoney(mcapRaw);
    if (mc === null) errors.push(`line ${line}: market_cap_usd "${mcapRaw}"`);
    const k = `${chain}|${product_name}|${token_symbol}`;
    if (seen.has(k)) errors.push(`line ${line}: duplicate (chain, product, symbol)`);
    seen.add(k);
    rows.push({ snapshot_date: asOf, chain, product_name, token_symbol, issuer_name, asset_class, asset_type, market_cap_usd: mc ?? "0", source });
  });
  return { rows, errors };
}

/** Exact decimal sum of decimal strings (BigInt at 8 decimals). */
export function sumMoney(values) {
  let total = 0n;
  for (const v of values) {
    const [i, f = ""] = v.split(".");
    total += BigInt(i + f.padEnd(8, "0").slice(0, 8));
  }
  const s = total.toString().padStart(9, "0");
  const frac = s.slice(-8).replace(/0+$/, "");
  return frac ? `${s.slice(0, -8)}.${frac}` : s.slice(0, -8);
}

export function summarize(rows) {
  const products = new Set(rows.map((r) => r.product_name));
  const issuers = new Set(rows.map((r) => r.issuer_name));
  const chains = new Set(rows.map((r) => r.chain));
  const nonzero = rows.filter((r) => r.market_cap_usd !== "0");
  return {
    rows: rows.length,
    nonzero: nonzero.length,
    zero: rows.length - nonzero.length,
    emptySymbol: rows.filter((r) => !r.token_symbol).length,
    totalUsd: sumMoney(rows.map((r) => r.market_cap_usd)),
    products: products.size,
    issuers: issuers.size,
    chains: chains.size,
  };
}
