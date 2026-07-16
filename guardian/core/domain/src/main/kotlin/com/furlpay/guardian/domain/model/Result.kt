package com.furlpay.guardian.domain

/** Explicit success/failure — no exceptions across the domain boundary. */
sealed interface GuardianResult<out T> {
    data class Ok<T>(val value: T) : GuardianResult<T>
    data class Err(val message: String, val cause: Throwable? = null) : GuardianResult<Nothing>

    fun getOrNull(): T? = (this as? Ok)?.value
}
