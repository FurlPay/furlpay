package expo.modules.googlepay

import android.app.Activity
import android.util.Base64
import com.google.android.gms.tapandpay.TapAndPay
import com.google.android.gms.tapandpay.issuer.PushTokenizeRequest
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class GooglePayProvisioningModule : Module() {
    private val REQUEST_CODE_PUSH_TOKENIZE = 1001

    override fun definition() = ModuleDefinition {
        Name("GooglePayProvisioning")

        // `onProvisioningResult` is the ONLY thing JS may treat as a verdict.
        // `pushTokenize` resolves once the Activity has been LAUNCHED, which is
        // not an outcome — see lib/cards/provisioning.ts.
        Events("onProvisioningResult")

        // The verdict. TapAndPay returns it through the standard Activity result
        // channel, and without this listener the outcome was simply discarded —
        // which is why the JS layer had nothing to wait for.
        //
        // RESULT_OK is the only success. A cancellation is distinguished from a
        // failure because collapsing them reports a user dismissing the sheet as
        // an error, and an error as a dismissal.
        OnActivityResult { _, payload ->
            if (payload.requestCode != REQUEST_CODE_PUSH_TOKENIZE) return@OnActivityResult

            when (payload.resultCode) {
                Activity.RESULT_OK ->
                    sendEvent("onProvisioningResult", mapOf("added" to true))

                Activity.RESULT_CANCELED ->
                    sendEvent("onProvisioningResult", mapOf("added" to false, "cancelled" to true))

                else ->
                    sendEvent(
                        "onProvisioningResult",
                        mapOf(
                            "added" to false,
                            // The numeric code is the only detail TapAndPay
                            // supplies here; it is diagnostic, and carries no
                            // card data.
                            "error" to "Google Wallet returned result code ${payload.resultCode}"
                        )
                    )
            }
        }

        // Both identifiers the TSP needs, and BOTH are real.
        //
        // `hardwareId` used to be the literal string "UNKNOWN". That is not a
        // harmless placeholder: Visa — the network Rain issues on — requires the
        // stable hardware id when generating the OPC, and the resulting OPC is
        // bound to whatever was supplied. An OPC minted against "UNKNOWN" is
        // bound to a device that does not exist, so tokenization fails on a real
        // handset with an error that points at the wallet rather than at this
        // line.
        //
        // getStableHardwareId() is per-PHYSICAL-DEVICE (stable across wallets on
        // that device, and it changes on factory reset), which is exactly the
        // binding the TSP wants. The two Tasks are chained rather than run in
        // parallel because a missing wallet makes the hardware id moot.
        AsyncFunction("getActiveWalletInfo") { promise: Promise ->
            val context = appContext.reactContext ?: return@AsyncFunction promise.reject("NO_CONTEXT", "React context is null", null)
            val tapAndPayClient = TapAndPay.getClient(context)

            tapAndPayClient.activeWalletId
                .addOnSuccessListener { walletId ->
                    tapAndPayClient.stableHardwareId
                        .addOnSuccessListener { hardwareId ->
                            promise.resolve(mapOf("walletId" to walletId, "hardwareId" to hardwareId))
                        }
                        .addOnFailureListener { e ->
                            // Deliberately NOT falling back to a placeholder. A
                            // provisioning attempt with an unusable hardware id
                            // fails later and less legibly than refusing here.
                            promise.reject("HARDWARE_ID_ERROR", "Failed to read the stable hardware id", e)
                        }
                }
                .addOnFailureListener { e ->
                    promise.reject("WALLET_INFO_ERROR", "Failed to get active wallet info", e)
                }
        }

        AsyncFunction("pushTokenize") { opcBase64: String, lastFour: String, displayName: String, promise: Promise ->
            val activity = appContext.currentActivity ?: return@AsyncFunction promise.reject("NO_ACTIVITY", "Current activity is null", null)
            val tapAndPayClient = TapAndPay.getClient(activity)

            // DECODE the base64, do not re-encode it.
            //
            // This was `opcBase64.toByteArray()`, which returns the UTF-8 bytes
            // of the base64 TEXT — so Google received the ASCII characters
            // "eyJhbG..." where it expected the binary OpenPGP container those
            // characters encode. The request is well-formed and the OPC inside
            // it is garbage, which surfaces as a generic tokenization failure.
            //
            // Base64.DEFAULT, not URL_SAFE: the OPC uses the standard alphabet
            // (+/ rather than -_), and DEFAULT also tolerates the line breaks a
            // PGP-armoured payload may carry.
            val opcBytes = try {
                Base64.decode(opcBase64, Base64.DEFAULT)
            } catch (e: IllegalArgumentException) {
                return@AsyncFunction promise.reject("INVALID_OPC", "Opaque payment card is not valid base64", e)
            }
            if (opcBytes.isEmpty()) {
                return@AsyncFunction promise.reject("INVALID_OPC", "Opaque payment card decoded to zero bytes", null)
            }

            val pushTokenizeRequest = PushTokenizeRequest.Builder()
                .setOpaquePaymentCard(opcBytes)
                .setNetwork(TapAndPay.CARD_NETWORK_VISA)
                .setTokenServiceProvider(TapAndPay.TOKEN_PROVIDER_VISA)
                .setDisplayName(displayName)
                .setLastDigits(lastFour)
                .build()

            try {
                tapAndPayClient.pushTokenize(activity, pushTokenizeRequest, REQUEST_CODE_PUSH_TOKENIZE)
                // Resolves because the Activity was LAUNCHED. Deliberately not a
                // verdict — the outcome arrives at OnActivityResult above, and
                // JS waits for `onProvisioningResult`.
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("TOKENIZE_ERROR", "Failed to start push tokenization", e)
            }
        }

        AsyncFunction("listTokens") { promise: Promise ->
            val context = appContext.reactContext ?: return@AsyncFunction promise.reject("NO_CONTEXT", "React context is null", null)
            val tapAndPayClient = TapAndPay.getClient(context)

            tapAndPayClient.listTokens()
                .addOnSuccessListener { tokens ->
                    val tokenList = tokens.map {
                        mapOf(
                            "id" to it.tokenId,
                            "network" to it.network,
                            "state" to it.tokenState
                        )
                    }
                    promise.resolve(tokenList)
                }
                .addOnFailureListener { e ->
                    promise.reject("LIST_TOKENS_ERROR", "Failed to list tokens", e)
                }
        }
    }
}
