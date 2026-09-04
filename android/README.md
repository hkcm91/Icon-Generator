# Shaker toys — Android live wallpapers

Wraps the interactive [`Liquid Shaker`](../wallpaper) and
[`Water Ring Toy`](../water-toy) pages in two `WallpaperService` entries, so
the thing selected from Android's wallpaper picker is the same page tested in
a browser — not a reimplementation of it.

That is the whole design intent. The physics, the optics and the look took a
long time to get right and they all live in the page; porting them to Kotlin
would mean maintaining two of everything and having them disagree. The service
is thin, and does only the three things a `WallpaperService` can do that a
browser tab cannot.

## Build it

Two ways, because the usual one needs Google's servers and not every machine
can reach them.

**With Gradle**, which is the real build — open `android/` in Android Studio
and press Run, or:

```bash
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

**Without Gradle**, using only what Debian and Ubuntu package:

```bash
sudo apt install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
tools/build-apk.sh
adb install -r build/liquid-shaker-debug.apk
```

That second path exists because this was written somewhere `dl.google.com` is
unreachable — which takes out the Android Gradle Plugin, AndroidX, the SDK
platforms and `aapt2` in one go. It compiles with `javac`, dexes with `dx`
(Debian calls it `dalvik-exchange`; note that `/usr/bin/dx` is OpenDX, an
unrelated visualisation tool that will be found first on `PATH`), packages
with `aapt`, and signs with a debug key it generates. It is the reason the
service is Java with no dependencies: nothing here needs AndroidX, so nothing
here needs a Maven repository.

The one difference between the two: Debian's newest platform is API 23, so the
offline build compiles against that and declares `targetSdk 30`, while Gradle
uses 34. Compiling against 23 is what keeps the source inside API 23 — the
software fallback locks a normal canvas rather than `lockHardwareCanvas()`,
which is API 26. Nothing is lost by that, since a detached WebView renders in
software either way.

The APK adds two launcher icons. Open **Liquid Shaker** or **Water Ring Toy**
to jump directly to that wallpaper's preview/apply screen, choose either under
**Settings → Wallpaper → Live Wallpapers**, or long-press the home screen.
Liquid Shaker is declared first and Water Ring Toy immediately after it;
pickers that preserve manifest order therefore show the toy beneath the
existing wallpaper. Android launchers ultimately control app-drawer and home
screen placement. Both entries fall back to the general live-wallpaper chooser
on vendor builds that omit the component-specific preview intent.

The pages are not duplicated into the app. The build copies them from
`../wallpaper/index.html` and `../water-toy/index.html`, so the APK cannot drift
from what was tested in a browser.

The lava lamp is the third entry, on the same engine: `LavaWallpaperService`
hosts `../wallpaper/lava.html` and knows nothing else. To set it from a shell:

```bash
adb shell am start -a android.service.wallpaper.CHANGE_LIVE_WALLPAPER \
  -e android.service.wallpaper.extra.LIVE_WALLPAPER_COMPONENT \
  com.hkcm.liquidshaker/.LavaWallpaperService
```

The water toy uses the same host bridge and adds its own simulation: two touch
pumps produce water jets and bubbles, rings collide with one another and the
glass, slow rings can settle onto pegs, a press releases them, and phone tilt,
shake, and launcher-page swipes feed the fluid motion.

## What the service actually does

**It gets a view hierarchy into the wallpaper surface.** A `WallpaperService`
hands out a `Surface`, not somewhere to put views. The good way to bridge that
is a virtual display backed by the wallpaper surface with a `Presentation` on
it: the WebView is then a normal attached, hardware-accelerated view and the
compositor does the work. The catch is that a `Presentation` is a `Dialog`, and
a `Dialog` wants a window token that a `Service` does not have — whether that
is refused depends on the platform version and the vendor. So it is attempted,
and if the window is refused the engine falls back to drawing the WebView into
the surface by hand once per frame. That always works and is slower, because a
WebView drawn into a canvas it is not attached to renders in software.

The fallback also takes over the page's clock. An unattached WebView has no
vsync to hang `requestAnimationFrame` off, so the page's loop either throttles
hard or never runs; the engine is already waking once a frame to draw, so it
steps the simulation itself through `__shaker.tick()`.

**It feeds the sensors in directly.** The page cannot get `devicemotion` here:
there is no browsing context delivering it and no secure origin to gate it on.
The service owns the sensors anyway, so it reads them and hands them over in
the units and the frame the web event uses. Android's accelerometer reports in
the same frame the web event does, so the values go straight across with no
conversion — which means both paths land on the same code in the page and
there is only one motion model to keep honest. The gyroscope's z axis is
converted from radians to the degrees per second the web event uses.

**It stops the page dead when the wallpaper is not on screen.** Behind the app
drawer or a full-screen app the wallpaper is not composited at all, and a
wallpaper that keeps simulating there is a battery leak.

Two extras that only exist because it is a wallpaper: swiping between home
screens tilts the liquid, through the same surface-tilt path that turning the
phone uses, so the sloshing that follows is the wave dynamics rather than an
animation; and a tap on the home screen drives a jet into the liquid under the
finger.

## The interface between the two halves

The page exposes `window.__shaker`:

| Call | What it is |
| --- | --- |
| `motion(x, y, z, spin)` | Raw `TYPE_ACCELEROMETER` values in m/s², plus rotation about the viewing axis in deg/s |
| `offset(t)` | Home-screen scroll position, 0..1 across all pages |
| `tap(nx, ny)` | A tap, in fractions of the surface |
| `pause()` / `resume()` | Stop and start the page's own loop |
| `drive()` / `tick()` | Hand the clock to the host, then step it |

Everything on that table is exercised from the browser in the repository's test
harness, against the same values the service sends.

## What is built, and what is still untested

The APK builds and is signed with v1, v2 and v3 schemes, so it installs on
anything from Android 5 upwards. Checked on the way out: the page inside the
APK is byte-identical to `../wallpaper/index.html`; the dex contains the
service and every one of the seven `window.__shaker` call sites, which match
the seven the page exposes; and `aapt` reports the wallpaper component, so the
picker will list it.

**It has never run on a handset.** There is no device or emulator here, so
"it builds, it is signed, and it contains what it should" is the whole of the
claim. The interface between the two halves is exercised in a headless browser
with the exact values and units the service sends, and rolling the phone 90
degrees produces an identical gravity vector down either route — but nothing
has drawn a frame on real hardware.

The likeliest thing to want attention is the `Presentation`. If logcat shows
*presentation refused, drawing the page by hand instead*, the hardware path was
rejected on your device and you are on the software fallback, which will be
noticeably slower.
