package com.furlpay.guardian.domain.model

/**
 * A single currency balance from `GET /api/wallets`. `usdValue` is the
 * server-priced USD equivalent — the watch never prices assets locally, so a
 * stale oracle on-device can't misstate what the user holds.
 */
data class Wallet(
    val id: String,
    /** Currency/token code, e.g. "USDC", "SOL", "ETH". */
    val currency: String,
    /** Native-unit balance (token amount, not USD). */
    val balance: Double,
    /** Server-computed USD value of [balance]. */
    val usdValue: Double,
    /** Chain the balance lives on ("arbitrum", "solana", …); null for fiat. */
    val chain: String? = null,
)

/** Aggregate view a tile/complication renders: total + largest-first list. */
data class WalletOverview(
    val totalUsd: Double,
    /** Sorted by [Wallet.usdValue] descending — the tile shows the top slice. */
    val wallets: List<Wallet>,
)
