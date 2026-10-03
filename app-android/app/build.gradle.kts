plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "co.sigpar.app"
    // Se compila contra la API 37.2 (lo exigen las librerías actuales); targetSdk sigue en 36.
    compileSdk {
        version = release(37) { minorApiLevel = 2 }
    }

    defaultConfig {
        applicationId = "co.sigpar.app"
        minSdk = 26          // Android 8.0 (definido en el estudio de factibilidad)
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        // Servidor por defecto. Se puede cambiar en la pantalla de inicio de sesión.
        // Con el celular conectado por USB y "adb reverse tcp:8080 tcp:8080", 127.0.0.1:8080 llega al PC.
        buildConfigField("String", "SERVIDOR_POR_DEFECTO", "\"http://127.0.0.1:8080\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            // En pruebas se permite http:// (servidor local). En la versión final solo https://
            manifestPlaceholders["permitirHttp"] = "true"
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-prueba"
        }
        release {
            manifestPlaceholders["permitirHttp"] = "false"
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "SERVIDOR_POR_DEFECTO", "\"https://sigpar.onrender.com\"")
            // Firma: ver docs/APP_ANDROID.md (keystore propio). Si no existe, se firma con la clave de depuración
            // para poder instalar el APK de demostración.
            val ks = rootProject.file("sigpar-release.jks")
            signingConfig = if (ks.exists()) signingConfigs.create("sigpar") {
                storeFile = ks
                storePassword = System.getenv("SIGPAR_KS_PASS") ?: ""
                keyAlias = "sigpar"
                keyPassword = System.getenv("SIGPAR_KS_PASS") ?: ""
            } else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    debugImplementation(libs.compose.ui.tooling)

    // Cámara + lectura de placas (ML Kit en el dispositivo: gratis y sin internet)
    implementation(libs.camera.core)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.mlkit.text)

    // Red y datos
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
}
