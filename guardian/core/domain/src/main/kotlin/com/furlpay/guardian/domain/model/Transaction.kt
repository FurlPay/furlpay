package com.furlpay.guardian.domain.model

import kotlinx.datetime.Instant

/** Money direction relative to the user. */
enum class TransactionDirection { IN, OUT }

/** One row of `GET /api/transactions`, normalized for watch display. */
data class Transaction(
    val id: String,
    val at: Instant,
    /** Human description ("Starbucks", "Swap USDC→SOL"). */
    val description: String,
    /** Always positive; [direction] carries the sign. */
    val amountUsd: Double,
    val direction: TransactionDirection,
    /** "pending" | "completed" | "failed" — server vocabulary, pass-through. */
    val status: String,
    val category: String? = null,
)
