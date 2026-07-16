package com.furlpay.guardian.data.datastore

import android.content.Context
import androidx.datastore.preferences.core.doublePreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.guardianDataStore by preferencesDataStore(name = "guardian_prefs")

/**
 * User preferences that are device-local by design (not account state):
 * briefing hour and the weekly budget the spending coach compares against.
 * Secrets do NOT go here — the session token lives in KeystoreTokenStore.
 */
class GuardianPreferences(context: Context) {

    private val store = context.applicationContext.guardianDataStore

    data class Prefs(
        /** Local hour (0–23) the morning briefing fires. */
        val briefingHour: Int,
        /** Weekly budget in USD; null = coach stays quiet about budgets. */
        val weeklyBudgetUsd: Double?,
    )

    val prefs: Flow<Prefs> = store.data.map { p ->
        Prefs(
            briefingHour = p[BRIEFING_HOUR] ?: DEFAULT_BRIEFING_HOUR,
            weeklyBudgetUsd = p[WEEKLY_BUDGET],
        )
    }

    suspend fun setBriefingHour(hour: Int) {
        store.edit { it[BRIEFING_HOUR] = hour.coerceIn(0, 23) }
    }

    suspend fun setWeeklyBudgetUsd(budget: Double?) {
        store.edit {
            if (budget == null || budget <= 0) it.remove(WEEKLY_BUDGET)
            else it[WEEKLY_BUDGET] = budget
        }
    }

    private companion object {
        val BRIEFING_HOUR = intPreferencesKey("briefing_hour")
        val WEEKLY_BUDGET = doublePreferencesKey("weekly_budget_usd")
        const val DEFAULT_BRIEFING_HOUR = 7
    }
}
