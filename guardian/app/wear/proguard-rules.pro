# Guardian watch — R8 rules.
#
# Shares the phone app's serialization/Retrofit surface (both talk to the same
# API through :core:network), plus the Wear-specific services that the SYSTEM
# instantiates by name from the manifest. Those are the dangerous ones: R8 sees
# no caller, strips them, and the tile or complication simply never renders —
# with no crash and no log to point at.

# --- kotlinx.serialization --------------------------------------------------
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}
-if @kotlinx.serialization.Serializable class ** {
    static **$* *;
}
-keepclassmembers class <2>$<3> {
    kotlinx.serialization.KSerializer serializer(...);
}
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault

# --- Retrofit + OkHttp ------------------------------------------------------
-keepattributes Signature,InnerClasses,EnclosingMethod,Exceptions
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

-keep interface com.furlpay.guardian.network.** { *; }
-keep class com.furlpay.guardian.network.dto.** { *; }

# --- Wear tiles -------------------------------------------------------------
# TileService subclasses are declared in the manifest and constructed by the
# system. Stripped or renamed, the tile is silently absent from the carousel.
-keep class * extends androidx.wear.tiles.TileService { *; }
-keep class * extends androidx.wear.protolayout.** { *; }
-keep class androidx.wear.tiles.** { *; }
-keep class androidx.wear.protolayout.** { *; }
-dontwarn androidx.wear.tiles.**

# --- Complications ----------------------------------------------------------
# Same failure mode: the complication provider disappears from the watch face
# picker with no error anywhere.
-keep class * extends androidx.wear.watchface.complications.datasource.ComplicationDataSourceService { *; }
-keep class androidx.wear.watchface.complications.** { *; }
-dontwarn androidx.wear.watchface.**

# --- Wearable Data Layer ----------------------------------------------------
-keep class * extends com.google.android.gms.wearable.WearableListenerService { *; }
-keep class com.google.android.gms.wearable.** { *; }
-dontwarn com.google.android.gms.**

# --- Horologist -------------------------------------------------------------
-dontwarn com.google.android.horologist.**

# --- Crash readability ------------------------------------------------------
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
