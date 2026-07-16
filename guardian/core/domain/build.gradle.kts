// Pure-Kotlin (JVM) domain module: models + use cases, no Android dependency.
// This is where the app's real logic lives, so it is fully unit-testable on any
// JVM — `./gradlew :core:domain:test` runs without an emulator or the SDK.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

dependencies {
    implementation(libs.kotlinx.coroutines.core)
    // api: JsonObject (action registry) and Instant (models) are part of this
    // module's public surface — consumers compile against them.
    api(libs.kotlinx.serialization.json)
    api(libs.kotlinx.datetime)

    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
}

kotlin {
    jvmToolchain(17)
}
