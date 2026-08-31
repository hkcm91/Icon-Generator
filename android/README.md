# Physics live wallpapers — Android

Wraps the pages in [`../wallpaper`](../wallpaper) in `WallpaperService`s, so
the thing you set from the wallpaper picker is the page you have been testing
in a browser — not a reimplementation of it.

That is the whole design intent. The physics, the optics and the look took a
long time to get right and they all live in the pages; porting them to Kotlin
would mean maintaining two of everything and having them disagree. The service
is thin, and does only the three things a `WallpaperService` can do that a
browser tab cannot.

Two wallpapers ship in the one APK, and the picker lists them separately:

| Picker entry | Page | What it is |
| --- | --- | --- |
| **Liquid Shaker** | `index.html` | Tilt to pour it, shake to throw the glitter |
| **Ferrofluid** | `ferrofluid.html` | Black liquid on white paper, spiking toward magnets you cannot see |

`WebWallpaperService` is all of the work and holds no opinion about which page
it is showing; a subclass is a page, a colour to paint until that page loads,
and a log tag. Both pages expose the same `window.__wallpaper` table, so the
host never has to know which one it has.

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

Then either open **Liquid Shaker** or **Ferrofluid** from the app launcher to
jump directly to Android's preview/apply screen for that one, choose
**Settings → Wallpaper → Live Wallpapers**, or long-press the home screen. The
two launcher entries are one activity behind an `activity-alias`, because the
preview intent names a component and the APK now carries two of them; which
one was tapped is read back from the alias's own manifest metadata, since the
launcher starts these with a bare `MAIN` intent and there is nowhere for an
extra to come from. Both entries fall back to the general live-wallpaper
chooser on vendor builds that do not support the component-specific preview
intent.

The pages are not duplicated into the app. Both builds copy them out of
`../wallpaper`, so there is one copy of each in the repository and the APK
cannot drift from what you tested in a browser.

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
steps the simulation itself through `__wallpaper.tick()`.

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

Two extras exist only because it is a wallpaper, and each page answers them in
its own terms rather than being handed an effect. Swiping between home screens
enters as motion the liquid does not have yet: the shaker tilts its surface,
and the ferrofluid gets the velocity a cell of liquid slid sideways is left
without — the slosh that follows is each solver doing what it already does. A
tap on the home screen drives a jet into the shaker's liquid, and sets a
magnet down under the finger in the ferrofluid.

## The interface between the two halves

Each page exposes `window.__wallpaper`, and `window.__shaker` as an alias —
that was the name before there was a second wallpaper to host, and keeping it
means a host built against the older page still drives either of them:

| Call | What it is |
| --- | --- |
| `motion(x, y, z, spin)` | Raw `TYPE_ACCELEROMETER` values in m/s², plus rotation about the viewing axis in deg/s |
| `offset(t)` | Home-screen scroll position, 0..1 across all pages |
| `tap(nx, ny)` | A tap, in fractions of the surface |
| `pause()` / `resume()` | Stop and start the page's own loop |
| `drive()` / `tick()` | Hand the clock to the host, then step it |

Everything on that table is exercised from the browser against the same values
the service sends, for both pages.

## What is built, and what is still untested

The APK builds and is signed with v1, v2 and v3 schemes, so it installs on
anything from Android 5 upwards. Checked on the way out: the pages inside the
APK are byte-identical to the ones in `../wallpaper`; the dex contains the
services and every `window.__wallpaper` call site, which match the table the
pages expose; and `aapt` reports both wallpaper components, so the picker will
list them.

The ferrofluid was added after that check was last run. Its Java compiles
clean against both API 30 and the API 23 the offline build uses, and its page
is exercised headlessly through the whole host table — but the APK itself has
not been rebuilt here, because this environment has neither `dl.google.com`
nor Debian's Android packages.

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
