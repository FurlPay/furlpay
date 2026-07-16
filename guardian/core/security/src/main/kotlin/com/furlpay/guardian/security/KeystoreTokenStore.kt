package com.furlpay.guardian.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.furlpay.guardian.network.TokenStore
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * FurlPay session JWT at rest: AES-256/GCM with a key that lives in the
 * AndroidKeyStore (non-exportable, hardware-backed where available). The
 * ciphertext sits in app-private SharedPreferences — same trust model as the
 * RN app's expo-secure-store, no deprecated androidx.security-crypto.
 *
 * Decryption failure (key invalidated by a lock-screen change, backup restore
 * onto new hardware) degrades to "signed out", never to a crash.
 */
class KeystoreTokenStore(context: Context) : TokenStore {

    private val prefs =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override suspend fun token(): String? = withContext(Dispatchers.IO) {
        val stored = prefs.getString(KEY_TOKEN, null) ?: return@withContext null
        try {
            val raw = Base64.decode(stored, Base64.NO_WRAP)
            val iv = raw.copyOfRange(0, IV_LENGTH)
            val ciphertext = raw.copyOfRange(IV_LENGTH, raw.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, iv))
            cipher.doFinal(ciphertext).decodeToString()
        } catch (_: Exception) {
            prefs.edit().remove(KEY_TOKEN).apply() // unrecoverable — force re-login
            null
        }
    }

    override suspend fun update(token: String?): Unit = withContext(Dispatchers.IO) {
        if (token == null) {
            prefs.edit().remove(KEY_TOKEN).apply()
            return@withContext
        }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val sealed = cipher.iv + cipher.doFinal(token.encodeToByteArray())
        prefs.edit().putString(KEY_TOKEN, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "furlpay.guardian.session"
        const val PREFS = "guardian.auth"
        const val KEY_TOKEN = "session.sealed"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_LENGTH = 12
        const val TAG_BITS = 128
    }
}
