#!/usr/bin/env bash
# Build a debug APK without Gradle, the Android Gradle Plugin, or the Google
# SDK downloads — none of which are reachable from every environment.
#
# It uses the Android tooling Debian packages instead:
#   aapt apksigner dalvik-exchange zipalign android-sdk-platform-23
#
# That platform is the newest Debian carries, which is why this project keeps
# its source inside API 23. Gradle remains the real build (see ../README.md);
# this exists so an APK can still be produced where dl.google.com cannot be
# reached.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
app="$here/../app/src/main"
pages="$here/../../wallpaper"
out="${1:-$here/../build}"
android_jar="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"

MIN_SDK=21
# Higher than the platform this compiles against, which is allowed: the compile
# SDK limits which APIs may be *referenced*, targetSdk only declares which
# behaviour the app opts into. It has to be at least 24, because Android 15
# refuses to install anything targeting lower.
TARGET_SDK=30

rm -rf "$out"
mkdir -p "$out/classes" "$out/assets"

# One copy of each page in the repository; the APK cannot drift from them.
# Both ship; res/values/strings.xml decides which one the service hosts.
cp "$pages/index.html" "$out/assets/index.html"
cp "$pages/milk.html"  "$out/assets/milk.html"

# aapt wants the package name and the sdk versions in the manifest itself.
# Gradle supplies both from the DSL (`namespace`, `defaultConfig`), so they are
# injected into a copy here rather than checked in and duplicated.
PKG=com.hkcm.liquidshaker
sed -e "s|<manifest |<manifest package=\"$PKG\" android:versionCode=\"1\" android:versionName=\"1.0\" |" \
    -e "s|<application|<uses-sdk android:minSdkVersion=\"$MIN_SDK\" android:targetSdkVersion=\"$TARGET_SDK\" />\n    <application|" \
    "$app/AndroidManifest.xml" > "$out/AndroidManifest.xml"

# R.java, which the service needs to read which page to host out of
# res/values/strings.xml. Gradle generates this as a matter of course; here it
# is an explicit aapt pass, and it has to come before javac.
echo "==> aapt R.java"
mkdir -p "$out/gen"
aapt package -f -m -J "$out/gen" \
     -M "$out/AndroidManifest.xml" \
     -S "$app/res" \
     -I "$android_jar"

echo "==> javac"
javac -nowarn -source 8 -target 8 \
      -bootclasspath "$android_jar" -classpath "$android_jar" \
      -d "$out/classes" \
      $(find "$app/java" "$out/gen" -name '*.java')

# Debian calls Android's dx "dalvik-exchange"; /usr/bin/dx is OpenDX, an
# unrelated visualisation tool that will happily be found first on PATH.
dexer="$(command -v dalvik-exchange || command -v d8 || true)"
[ -n "$dexer" ] || { echo "no dexer found (apt install dalvik-exchange)" >&2; exit 1; }
echo "==> dex ($dexer)"
"$dexer" --dex --output="$out/classes.dex" "$out/classes"

echo "==> aapt package"
aapt package -f \
     -M "$out/AndroidManifest.xml" \
     -S "$app/res" \
     -A "$out/assets" \
     -I "$android_jar" \
     -F "$out/app-unaligned.apk"

echo "==> add dex"
( cd "$out" && aapt add -f app-unaligned.apk classes.dex >/dev/null )

echo "==> zipalign"
zipalign -f 4 "$out/app-unaligned.apk" "$out/app-unsigned.apk"

echo "==> sign"
keystore="$out/debug.keystore"
keytool -genkeypair -keystore "$keystore" -storepass android -keypass android \
        -alias androiddebugkey -dname "CN=Android Debug,O=Android,C=US" \
        -keyalg RSA -keysize 2048 -validity 10000 >/dev/null 2>&1
apksigner sign --ks "$keystore" --ks-pass pass:android --key-pass pass:android \
          --out "$out/liquid-shaker-debug.apk" "$out/app-unsigned.apk"
apksigner verify --print-certs "$out/liquid-shaker-debug.apk" | head -4

echo
echo "built: $out/liquid-shaker-debug.apk"
