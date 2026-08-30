# Brief: get this running on an emulator

You have an Android emulator. This has never run on one, or on any handset.
Everything below is what is known, what is not, and what would be most useful
to find out.

## What it is

A live wallpaper that hosts a web page rather than reimplementing it. The
page — `wallpaper/index.html` — is a liquid glitter shaker: a fluid solver, a
free surface, buoyant glitter, bubbles with real optics. It is about 3,000
lines and it is where all the behaviour lives. The Android side
(`android/app/src/main/java/com/hkcm/liquidshaker/ShakerWallpaperService.java`,
~300 lines) does only what a browser tab cannot: get a view hierarchy into the
wallpaper surface, feed it the sensors, and stop it when the wallpaper is not
on screen.

Repository: `hkcm91/Icon-Generator`, branch
`claude/blender-liquid-shaker-wallpaper-uvjkoy`.

## Build and install

```bash
cd android
./gradlew :app:assembleDebug          # if you can reach dl.google.com
adb install -r app/build/outputs/apk/debug/app-debug.apk

# or, without Google's servers:
sudo apt install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
tools/build-apk.sh
adb install -r build/liquid-shaker-debug.apk
```

Set it: **Settings → Wallpaper → Live Wallpapers → Liquid Shaker**, or
long-press the home screen. This may also work depending on the image:

```bash
adb shell am start -a android.service.wallpaper.CHANGE_LIVE_WALLPAPER \
  -e android.service.wallpaper.extra.LIVE_WALLPAPER_COMPONENT \
  com.hkcm.liquidshaker/.ShakerWallpaperService
```

Watch it with `adb logcat -s LiquidShaker:V chromium:V`. A debuggable build
forwards the page's console into logcat and turns on frame timing, so you
should see a line every two seconds:

```
I/LiquidShaker: shaker fps=58.2 js=6.4ms canvas=1080x2400 stars=980 micro=2320 bubbles=72 fizz=0
```

## What to find out, in order

**1. Does it draw at all?** A blank, black or white wallpaper is the failure
worth reporting fastest. Screenshot it.

**2. Which hosting path did it take?** This is the single most important
answer. A `WallpaperService` hands out a Surface, not somewhere to put views,
so the engine tries a virtual display with a `Presentation` on it — the good
path, where the WebView is a normal hardware-accelerated view. A `Presentation`
is a `Dialog` though, and a `Dialog` wants a window token a `Service` does not
have, so it may be refused. Logcat says which:

```
I/LiquidShaker: hosting the page on a virtual display (hardware accelerated)
W/LiquidShaker: presentation refused, drawing the page by hand instead
```

If it is the fallback, include the stack trace — it says exactly what refused.

**3. What frame rate?** Every measurement so far has been a software
rasteriser in a container, so the real number is unknown. Read `fps=` from the
log at rest, then while shaking. `js=` is time inside the simulation; if `fps`
is low while `js` is small, the cost is compositing rather than the physics.
Note the emulator's GPU mode (`-gpu host` versus `swiftshader_indirect`) —
it will dominate this, and a software-GPU emulator number says little about a
handset.

**4. Do the sensors reach it?** Tilt should make the liquid find level; a
shake should throw the glitter and produce fizz.

```bash
adb emu sensor set acceleration 0:9.81:0     # upright
adb emu sensor set acceleration 9.81:0:0     # rolled 90 degrees
adb emu sensor set acceleration 0:-9.81:0    # upside down
```

Extended Controls → Virtual sensors is the reliable way if that command is not
accepted. Held at 90 degrees the waterline should settle perpendicular to the
new gravity within a second or two, and the glitter should drift toward what
is now the top over about thirty seconds.

**5. The wallpaper-only interactions.** Swiping between home screens should
tilt the liquid and set it sloshing. A tap on the home screen should drive a
visible jet into the liquid under the finger. Opening an app and coming back
should not leave it frozen — and while an app is in front, the wallpaper
should stop simulating entirely, which you can confirm by the `shaker fps=`
lines stopping.

**6. Does it survive a rotation?** That destroys and recreates the surface.
Watch for a crash, a leak, or a black wallpaper afterwards.

## Where I would expect trouble

- **The `Presentation`.** Most likely thing to fail. If it does, the fallback
  runs, and the fallback is software: a WebView drawn into a canvas it is not
  attached to renders in software however the canvas was locked.
- **A black wallpaper on the hardware path.** A WebView inside a virtual
  display can composite to nothing on some images. If path 2 says "hardware
  accelerated" and the screen is blank, that is the case, and forcing the
  fallback would confirm it.
- **`canvas=` in the log not matching the screen.** The page sizes itself from
  `window.innerWidth/innerHeight`; if the WebView is laid out wrong, the
  wallpaper will be cropped or letterboxed.
- **The fallback's clock.** An unattached WebView has no vsync, so
  `requestAnimationFrame` may never fire. The engine takes the clock over
  (`__shaker.drive()` / `tick()`) for exactly that reason, but if the page is
  visibly frozen while frames are being drawn, that handover is where to look.

## Already verified — no need to redo

- The APK builds, is signed v1+v2+v3, and installs from Android 5 up.
- `assets/index.html` inside the APK is byte-identical to
  `wallpaper/index.html`.
- The dex carries the service and all seven `window.__shaker` call sites, and
  they match the seven the page exposes.
- `aapt` reports the wallpaper component, so the picker will list it.
- The page-side interface is exercised in a headless browser with the exact
  values and units the service sends. Rolling 90 degrees produces an identical
  gravity vector whether it arrives through the browser's `devicemotion` or
  through `__shaker.motion()`.

## The interface between the two halves

`window.__shaker`, called from the service by `evaluateJavascript`:

| Call | What it is |
| --- | --- |
| `motion(x, y, z, spin)` | Raw `TYPE_ACCELEROMETER` in m/s², plus rotation about the viewing axis in deg/s |
| `offset(t)` | Home-screen scroll, 0..1 across all pages |
| `tap(nx, ny)` | A tap, in fractions of the surface |
| `pause()` / `resume()` | Stop and start the page's own loop |
| `drive()` / `tick()` | Hand the clock to the host, then step it |
| `diag(on)` | Frame timing to the console |

## What to change, and what to hand back

Fix anything small and local — a wrong flag, a missing null check, a layout
that needs a measure pass. Do not rewrite the page's physics or its rendering
to chase a frame rate; that code is heavily measured and the numbers behind
each decision are in `wallpaper/README.md`. If the answer turns out to be
"the whole hosting approach is wrong on this platform", say so with the
evidence rather than building around it.

Useful to hand back: the logcat excerpt, a screen recording, the `fps=` and
`js=` numbers at rest and while shaking, the emulator image and GPU mode, and
which hosting path it took.
