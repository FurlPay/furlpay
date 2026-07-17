package com.furlpay.guardian.mobile.service

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.furlpay.guardian.mobile.mobileServices
import java.util.concurrent.TimeUnit

/**
 * Periodic heartbeat: pull fresh state, re-arm alarm ladders, push snapshots
 * to the watch. Without this, tiles/complications only update when the user
 * opens an app — and an alarm armed before a reboot would stay lost.
 *
 * 15 minutes is WorkManager's floor for periodic work; alarm EXACTNESS does
 * not depend on this cadence (AlarmManager holds the armed rungs) — the
 * worker only (re)arms and refreshes data.
 */
class GuardianSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val services = applicationContext.mobileServices
        // Signed out → nothing to sync; stay scheduled for after sign-in.
        if (services.tokenStore.token() == null) return Result.success()
        return try {
            services.sync.pushAll()
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val UNIQUE_NAME = "guardian-periodic-sync"

        /** Idempotent — call on every app start. */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<GuardianSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }
    }
}
