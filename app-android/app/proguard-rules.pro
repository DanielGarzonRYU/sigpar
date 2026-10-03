# kotlinx.serialization: conservar los serializadores generados de los modelos de la API
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class co.sigpar.app.data.** {
    *** Companion;
}
-keepclasseswithmembers class co.sigpar.app.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class co.sigpar.app.data.**$$serializer { *; }

# OkHttp
-dontwarn okhttp3.internal.platform.**
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**
