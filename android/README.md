# Liquid shaker — Android live wallpaper

Wraps [`../wallpaper/index.html`](../wallpaper) in a `WallpaperService`, so the
thing you set from the wallpaper picker is the page you have been testing in a
browser — not a reimplementation of it.

That is the whole design intent. The physics, the optics and the look took a
long time to get right and they all live in the page; porting them to Kotlin
would mean maintaining two of everything and having them disagree. The service
is thin, and does only the three things a `WallpaperService` can do that a
browser tab cannot.

## Build it

```bash
# from this directory, with Android Studio's SDK on ANDROID_HOME
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or open `android/` in Android Studio and press Run. Then: **Settings →
Wallpaper → Live Wallpapers → Liquid Shaker**, or long-press the home screen.

The page is not duplicated into the app. `app/build.gradle.kts` copies it out
of `../wallpaper/index.html` at build time, so there is one copy of it in the
repository and the APK cannot drift from what you tested.

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

## Not verified

**This has never been compiled.** The container this was written in has no
Android SDK and cannot reach `dl.google.com` to fetch one, so there is no
`android.jar` to build against and nothing here has been through a compiler,
let alone onto a handset. Treat it as a careful first draft: the structure and
the Android APIs are the right ones, but expect to fix something on the first
build.

What *has* been verified is the part where the two halves meet — the
`window.__shaker` calls above are driven from a headless browser with the exact
values and units the Kotlin sends, and checked against the browser's own
`devicemotion` path. Rolling the phone 90 degrees produces an identical gravity
vector down both routes.

The likeliest thing to need attention is the `Presentation`: if the log shows
*presentation refused, drawing the page by hand instead*, the hardware path was
rejected on your device and you are on the software fallback, which will be
noticeably slower.
