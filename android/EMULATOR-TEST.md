# Brief: get this running on an emulator

You have an Android emulator. This has never run on one, or on any handset.
Everything below is what is known, what is not, and what would be most useful
to find out.

## What it is

Live wallpapers that host web pages rather than reimplementing them. There are
two, in one APK:

- **Liquid Shaker** — `wallpaper/index.html`, a liquid glitter shaker: a fluid
  solver, a free surface, buoyant glitter, bubbles with real optics.
- **Ferrofluid** — `wallpaper/ferrofluid.html`, black liquid on white paper: a
  particle liquid with cohesion, and magnets that drag it into Rosensweig
  spikes. Newer, and the less tested of the two.

Each page is where all of its own behaviour lives. The Android side
(`android/app/src/main/java/com/hkcm/liquidshaker/WebWallpaperService.java`,
~360 lines, plus a dozen lines per wallpaper) does only what a browser tab
cannot: get a view hierarchy into the wallpaper surface, feed it the sensors,
and stop it when the wallpaper is not on screen. It holds no opinion about
which page it is showing.

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

Set one: **Settings → Wallpaper → Live Wallpapers → Liquid Shaker** (or
**Ferrofluid**), or long-press the home screen, or open either of the two app
drawer entries. This may also work depending on the image:

```bash
adb shell am start -a android.service.wallpaper.CHANGE_LIVE_WALLPAPER \
  -e android.service.wallpaper.extra.LIVE_WALLPAPER_COMPONENT \
  com.hkcm.liquidshaker/.ShakerWallpaperService
# ...or .FerrofluidWallpaperService
```

Both should be listed by the picker, each with its own thumbnail. If only one
appears, that is worth reporting on its own — it means `aapt` or the manifest
merge dropped a component.

Watch it with `adb logcat -s LiquidShaker:V Ferrofluid:V chromium:V` — the two
wallpapers use separate tags precisely so they stay separable. A debuggable build
forwards the page's console into logcat and turns on frame timing, so you
should see a line every two seconds:

```
I/LiquidShaker: shaker fps=58.2 js=6.4ms canvas=1080x2400 stars=1650 micro=17850 bubbles=112 fizz=0
I/Ferrofluid:  ferrofluid fps=58.9 js=4.1ms canvas=1080x2400 drops=1000 grid=112x212 loops=9 poles=2
```

The `js=` figure is the one number worth having from real hardware. Every
measurement so far is a software rasteriser in a container, which is the wrong
machine in both directions — slower than a phone's GPU at the drawing, faster
than a phone's CPU at the arithmetic. If the ferrofluid cannot hold a frame
rate, `ferrofluid.html?drops=700` is the dial: the solver is most of its cost
and it is linear in the drop count.

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
set the liquid sloshing in either wallpaper. A tap on the home screen should
drive a visible jet into the shaker's liquid, and in the ferrofluid should set
a magnet down under the finger — a ring where you touched, and the liquid
reaching toward it if it is anywhere near. Opening an app and coming back
should not leave either frozen; and while an app is in front, the wallpaper
should stop simulating entirely, which you can confirm by the `fps=` lines
stopping.

**5b. The ferrofluid, specifically.** Left alone, the pool at the bottom
should never be still for long: crests rising and falling, beads thrown clear
and pulled back. If it lies flat as a black bar for thirty seconds at a time,
the magnets are not reaching it. If it boils into a spray of droplets that
never recombines, a stability guard has failed — which of the three is in
`wallpaper/FERROFLUID.md` under *Fixed timestep*.

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
  (`__wallpaper.drive()` / `tick()`) for exactly that reason, but if the page is
  visibly frozen while frames are being drawn, that handover is where to look.

## Already verified — no need to redo

- The APK builds, is signed v1+v2+v3, and installs from Android 5 up.
- `assets/index.html` inside the APK is byte-identical to
  `wallpaper/index.html`. (This check predates the ferrofluid; the same should
  hold for `assets/ferrofluid.html`.)
- The dex carries the service and all seven `window.__wallpaper` call sites, and
  they match the seven the page exposes.
- `aapt` reports the wallpaper component, so the picker will list it.
- The Java compiles clean against API 30 and against the API 23 the offline
  build uses, with both wallpapers in it.
- The page-side interface is exercised in a headless browser with the exact
  values and units the service sends. Rolling 90 degrees produces an identical
  gravity vector whether it arrives through the browser's `devicemotion` or
  through `__wallpaper.motion()`.

## The interface between the two halves

`window.__wallpaper` (aliased as `window.__shaker`), called from the service
by `evaluateJavascript`:

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
each decision are in `wallpaper/README.md` and `wallpaper/FERROFLUID.md`. If
the answer turns out to be
"the whole hosting approach is wrong on this platform", say so with the
evidence rather than building around it.

Useful to hand back: the logcat excerpt, a screen recording, the `fps=` and
`js=` numbers at rest and while shaking, the emulator image and GPU mode, and
which hosting path it took.
