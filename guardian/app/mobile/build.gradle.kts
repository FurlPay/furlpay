// Life Guardian phone app — "the brain". Hosts sign-in (email OTP against
// furlpay.com), the dashboard, the watch voice relay, and the FCM client.
// google-services.json is needed only for Firebase AT RUNTIME (Gemini + FCM);
// the build stays green without it and the voice relay falls back to the
// deterministic rule parser.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.furlpay.guardian.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.furlpay.guardian"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
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
    implementation(project(":core:domain"))
    implementation(project(":core:network"))
    implementation(project(":core:security"))
    implementation(project(":core:sync"))
    implementation(project(":core:data"))
    implementation(project(":core:ai"))

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.datetime)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    // Watch relay
    implementation(libs.play.services.wearable)
    implementation(libs.kotlinx.coroutines.play.services)

    // FCM client (server side already live — lib/fcm.ts)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
}
