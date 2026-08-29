plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/* The wallpaper page is not duplicated into the app. It is copied out of
 * ../wallpaper at build time, so there is one copy of it in the repository
 * and the APK cannot drift from the version you have been testing in a
 * browser. */
val copyWallpaperPage by tasks.registering(Copy::class) {
    from(rootProject.file("../wallpaper/index.html"))
    into(layout.buildDirectory.dir("generated/wallpaperAssets"))
}

android {
    namespace = "com.hkcm.liquidshaker"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.hkcm.liquidshaker"
        // 26 is the floor for SurfaceHolder.lockHardwareCanvas(), which the
        // software fallback path needs.
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/wallpaperAssets"))

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

tasks.named("preBuild") { dependsOn(copyWallpaperPage) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
}
