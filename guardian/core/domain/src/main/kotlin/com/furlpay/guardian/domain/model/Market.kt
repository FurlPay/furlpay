package com.furlpay.guardian.domain.model

/**
 * Live market surface — mirrors what native-app/app/markets.tsx and
 * market/[symbol].tsx read from /api/markets*. `logoPath` is the self-hosted
 * TradingView mark ("/logos/stocks/aapl.svg") served from furlpay.com; render
 * a two-letter monogram underneath as the always-present fallback, exactly
 * like the native <AssetLogo>.
 */
data class MarketQuote(
    val symbol: String,
    val name: String,
    /** "stock" | "etf" | "crypto" */
    val kind: String,
    /** Null when the asset has no quote (see MarketItemDto.price). */
    val price: Double?,
    val changePct: Double?,
    val live: Boolean,
    /** "live" | "delayed" | "unavailable". */
    val quoteStatus: String = "live",
    val logoPath: String?,
) {
    /** True when there is a real price to show. Glanceable surfaces (tiles,
     *  complications) should hide the value entirely when this is false rather
     *  than rendering a placeholder the user cannot act on. */
    val hasQuote: Boolean get() = price != null && price.isFinite() && quoteStatus != "unavailable"
    val hasChange: Boolean get() = changePct != null && changePct.isFinite()
}

/** One OHLC bar from /api/markets/bars. Time is epoch millis. */
data class Candle(
    val time: Long,
    val open: Double,
    val high: Double,
    val low: Double,
    val close: Double,
)

/** /api/markets/{symbol} — quote + the user's position when signed in. */
data class AssetDetail(
    val quote: MarketQuote,
    val positionShares: Double?,
    val positionValueUsd: Double?,
) {
    /** Crypto trades via Swap on the phone; stocks & ETFs order here. */
    val tradable: Boolean get() = quote.kind != "crypto"
}

/** POST /api/investing/order result. */
data class OrderFill(
    val orderId: String,
    /** "filled" | "accepted" | ... — server-decided. */
    val status: String,
    val filledQty: Double,
)
