package com.furlpay.guardian.network

import com.furlpay.guardian.domain.GuardianResult
import com.furlpay.guardian.domain.action.ResolvedConfirmation
import kotlinx.serialization.json.JsonObject

/**
 * Executes a registry-validated action. The type system enforces the security
 * order: you cannot call [dispatch] without a [ResolvedConfirmation.Ok], and
 * the only way to obtain one is GuardianActionRegistry.resolve() — so an
 * unvalidated model proposal can never reach the network.
 *
 * The BIOMETRIC gate is the caller's job (it needs an Activity); every
 * dispatch here must already sit behind it.
 */
class ActionDispatcher(private val api: FurlPayApi) {

    suspend fun dispatch(resolved: ResolvedConfirmation.Ok): GuardianResult<JsonObject> =
        try {
            // Registry endpoints carry a leading "/" ("/cards/settings");
            // Retrofit resolves relative @Url against the /api/ base, so strip it.
            GuardianResult.Ok(api.dispatch(resolved.endpoint.trimStart('/'), resolved.body))
        } catch (e: Exception) {
            GuardianResult.Err(e.message ?: "Action failed", e)
        }
}
