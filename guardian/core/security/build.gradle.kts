// Auth + crypto: Keystore-encrypted session token store (implements
// :core:network's TokenStore) and the biometric gate mutating tools must pass.
// Deliberately NOT androidx.security-crypto (deprecated 2024) — raw
// AndroidKeyStore AES/GCM instead.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.furlpay.guardian.security"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    api(project(":core:network")) // TokenStore interface

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.androidx.core.ktx)
    implementation(libs.biometric)
}
