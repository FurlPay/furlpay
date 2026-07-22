package com.furlpay.wearbridge

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Wear OS bridge for the RN app's "Connect to Watch" screen.
 *
 * DESIGN NOTE (why not react-native-wear-connectivity): the Wearable
 * MessageClient only routes between phone/watch apps sharing ONE package
 * name. This app is com.furlpay.app; the watch app is com.furlpay.guardian —
 * messages would silently vanish. NodeClient, however, lists paired watch
 * nodes for ANY caller, which is exactly what a connect screen needs. The
 * actual Data Layer sync stays in the Guardian phone app (same package as
 * the watch app), which this module detects and launches.
 */
class WearBridgeModule : Module() {

    override fun definition() = ModuleDefinition {
        Name("WearBridge")

        /** Paired-and-connected watch nodes: [{id, name, isNearby}]. */
        AsyncFunction("getConnectedWatches") { promise: Promise ->
            val context = appContext.reactContext
            if (context == null) {
                promise.resolve(emptyList<Map<String, Any>>())
                return@AsyncFunction
            }
            Wearable.getNodeClient(context).connectedNodes
                .addOnSuccessListener { nodes ->
                    promise.resolve(
                        nodes.map {
                            mapOf(
                                "id" to it.id,
                                "name" to it.displayName,
                                "isNearby" to it.isNearby,
                            )
                        },
                    )
                }
                .addOnFailureListener {
                    // No Play services / no Wear module — same UX as no watch.
                    promise.resolve(emptyList<Map<String, Any>>())
                }
        }

        /** Is the FurlPay Guardian companion app installed on this phone? */
        Function("isGuardianInstalled") {
            val pm = appContext.reactContext?.packageManager ?: return@Function false
            try {
                // getPackageInfo(String, Int) is deprecated from API 33; the
                // PackageInfoFlags overload does not exist below it, so both
                // paths stay.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    pm.getPackageInfo(GUARDIAN_PACKAGE, PackageManager.PackageInfoFlags.of(0L))
                } else {
                    @Suppress("DEPRECATION")
                    pm.getPackageInfo(GUARDIAN_PACKAGE, 0)
                }
                true
            } catch (e: Exception) {
                false
            }
        }

        /** Launch Guardian (it owns sign-in + watch Data Layer sync). */
        Function("openGuardian") {
            val context = appContext.reactContext ?: return@Function false
            val intent = context.packageManager
                .getLaunchIntentForPackage(GUARDIAN_PACKAGE)
                ?: return@Function false
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            true
        }
    }

    companion object {
        const val GUARDIAN_PACKAGE = "com.furlpay.guardian"
    }
}
