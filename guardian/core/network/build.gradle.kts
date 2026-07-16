// Retrofit/OkHttp client for furlpay.com/api. Pure JVM on purpose: every
// request the watch/phone can make — including the money-mutating ones — is
// exercised against MockWebServer in plain unit tests, no emulator required.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

dependencies {
    api(project(":core:domain"))

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}

kotlin {
    jvmToolchain(17)
}
