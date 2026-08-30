plugins {
    id("com.android.application")
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
        minSdk = 21
        targetSdk = 34
        versionCode = 10
        versionName = "1.9"
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/wallpaperAssets"))

    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

tasks.named("preBuild") { dependsOn(copyWallpaperPage) }

/* No dependencies. Nothing here needs AndroidX: the service is a
 * WallpaperService, a WebView and a SensorManager, all of them platform. That
 * is also what lets tools/build-apk.sh work without a Maven repository. */
