import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db, newTx, recordTransaction } from "@/lib/store";
import { recordMovement } from "@/lib/ledger";

// POST /api/investing/order — place a fractional stock/ETF order (Alpaca).
// Accepts EITHER `notional` (USD) OR `qty` (shares), never both (→ 400),
// matching Alpaca's contract. Supports market/limit/stop/stop_limit + TIF.
const ORDER_TYPES = ["market", "limit", "stop", "stop_limit"];
const TIFS = ["day", "gtc", "ioc", "fok", "opg", "cls"];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { symbol, side, notional, qty, type = "market", time_in_force = "day", limit_price, stop_price } = body;

  if (!symbol || !side) {
    return NextResponse.json({ error: "symbol and side are required" }, { status: 400 });
  }
  if (side !== "buy" && side !== "sell") {
    return NextResponse.json({ error: "side must be 'buy' or 'sell'" }, { status: 400 });
  }
  // Alpaca: qty and notional are mutually exclusive; exactly one required.
  const hasNotional = notional !== undefined && notional !== null;
  const hasQty = qty !== undefined && qty !== null;
  if (hasNotional && hasQty) {
    return NextResponse.json({ error: "Provide either qty or notional, not both" }, { status: 400 });
  }
  if (!hasNotional && !hasQty) {
    return NextResponse.json({ error: "Provide qty or notional" }, { status: 400 });
  }
  if (!ORDER_TYPES.includes(type)) {
    return NextResponse.json({ error: `type must be one of ${ORDER_TYPES.join(", ")}` }, { status: 400 });
  }
  if (!TIFS.includes(time_in_force)) {
    return NextResponse.json({ error: `time_in_force must be one of ${TIFS.join(", ")}` }, { status: 400 });
  }
  if ((type === "limit" || type === "stop_limit") && limit_price === undefined) {
    return NextResponse.json({ error: "limit_price required for limit/stop_limit orders" }, { status: 400 });
  }
  if ((type === "stop" || type === "stop_limit") && stop_price === undefined) {
    return NextResponse.json({ error: "stop_price required for stop/stop_limit orders" }, { status: 400 });
  }

  const holding = db.holdings.find((h) => h.symbol === String(symbol).toUpperCase());
  if (!holding) return NextResponse.json({ error: "Symbol not found" }, { status: 404 });

  const price = type === "limit" || type === "stop_limit" ? Number(limit_price) : holding.price;
  const filledQty = hasNotional ? Number(notional) / holding.price : Number(qty);
  const notionalUsd = hasNotional ? Number(notional) : Number(qty) * holding.price;

  // Non-market orders rest as "pending"; market fills immediately.
  const status = type === "market" ? "filled" : "pending";

  if (status === "filled") {
    if (side === "buy") holding.shares += filledQty;
    else holding.shares = Math.max(0, holding.shares - filledQty);
    holding.marketValue = holding.shares * holding.price;

    recordTransaction(
      newTx({
        category: "invest",
        direction: side === "buy" ? "out" : "in",
        title: `${side === "buy" ? "Bought" : "Sold"} ${holding.symbol}`,
        subtitle: `Alpaca · ${type} · ${filledQty.toFixed(3)} sh`,
        amountUsd: notionalUsd,
        status: "settled",
      })
    );
    // Buy moves cash out; sell brings cash in.
    recordMovement(side === "buy" ? "out" : "in", notionalUsd, `${side === "buy" ? "Buy" : "Sell"} ${holding.symbol}`);
  }

  return NextResponse.json({
    orderId: "ord_" + crypto.randomBytes(6).toString("hex"),
    status,
    symbol: holding.symbol,
    side,
    type,
    time_in_force,
    filledQty: status === "filled" ? filledQty : 0,
    limit_price: limit_price ?? null,
    stop_price: stop_price ?? null,
  });
}
