# Liquid shaker — interactive wallpaper

A full-screen liquid shaker that actually responds to the phone: tilt it and
the liquid finds level, shake it and the whole thing sloshes and throws the
glitter around. One self-contained HTML file, no build step, no dependencies.

This is the half that reacts. The [Blender pipeline](../blender) bakes the
hero loop at full render quality, but a baked loop plays back identically no
matter how hard you shake the phone — the two are complementary.

## Try it

Open `index.html` in a browser. On a phone it uses the real sensors; on a
desktop, drag to tilt and flick to shake.

## How it moves

Three coupled pieces.

**A fluid velocity field** — coarse stable-fluids on roughly 1500 cells:
body force, vorticity confinement, semi-Lagrangian advection, Jacobi
pressure projection. This is what carries the glitter. It is driven by the
container's own acceleration, because in the non-inertial frame of a shaken
vessel the liquid feels a body force of −a, and that is the actual physical
cause of sloshing. Incompressibility turns a shove into a swirl for free:
the fluid cannot pile up against a wall, so it has to roll.

**A free surface** — a one-dimensional height field in the gravity frame,
so arbitrary tilt costs only a change of basis. Wave speed scales with the
in-plane component of gravity, since that is what actually provides the
restoring force. It is coupled to the fluid beneath it, which is what gives
the waterline structure; driven by the tilt term alone it can only ever be a
straight line.

**Particles with Stokes drag** — response time and terminal velocity both
scale with radius squared, so fine glitter traces the flow almost exactly
while big flakes lag, overshoot on a turn and sink faster. That spread is
what makes a settle look like a real suspension rather than one moving
sheet. Flakes flutter as they sink; bubbles rise with buoyancy against drag.

Gravity is deliberately **not** normalised: the in-plane component genuinely
shrinks as the phone lies flatter, and normalising it makes a 5-degree tilt
pull as hard as an 85-degree one. It comes from a low-pass of the
accelerometer; the residual is the shake, which is a measured quantity
rather than a jerk heuristic.

Volume is conserved by feedback rather than by solving the tilted squircle's
area: each frame clips the liquid polygon against the container, measures the
area, and nudges the surface level toward the target. It settles in a few
frames and costs one shoelace sum.

### Fixed timestep

The simulation runs on a fixed 1/60s tick with an accumulator. This is not
tidiness. Scaling every force by `dt` is not sufficient: semi-Lagrangian
advection smears a fixed amount per *step* and the pressure solve does a
fixed number of iterations per *step*, so both get twice the treatment at
twice the frame rate. Measured before the fix, the same two seconds of
shaking left the flow energy 21.6% apart between 30fps and 60fps; after,
0.0%.

## Options

Append as query parameters, e.g. `index.html?fill=0.7&stars=320`.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `mode` | `full` | `full` fills the screen; `pouch` floats a discrete squircle on a backdrop |
| `fill` | `0.86` | Fraction of the container holding liquid. The air gap is what sloshes — at `1` nothing moves |
| `n` | `4` | Corner squareness: 2 circular, 4 squircle, 8 nearly square |
| `corner` | `12%` of the short edge | Corner radius in pixels (`full` mode) |
| `stars` | `260` | Confetti count |
| `bubbles` | `46` | Bubble count |
| `scale` | `0.78` | Container size against the short edge (`pouch` mode only) |

Drop `stars` to about 120 and `bubbles` to 20 on a low-end device.

## Getting it onto an Android home screen

Android has no built-in way to set a web page or a video as a live wallpaper,
so all three routes below need a host of some kind. Worth knowing before you
pick one.

**Interactive, via a WebView wallpaper host.** Several apps on the Play Store
host a local HTML file as a live wallpaper. Copy `index.html` to the device
and point the app at it. This is the only route that keeps the shake
response. Check that the app grants the page motion-sensor access — some
WebView hosts do not, and the wallpaper falls back to a static tilt.

**Interactive, via your own `WallpaperService`.** The robust version: a small
Android app with a `WallpaperService` hosting a `WebView` pointed at this
file in `assets/`. Roughly a hundred lines of Kotlin and it behaves exactly
like a first-class live wallpaper. This repo ships the render layer, not an
APK.

**Pre-rendered, via a video wallpaper app.** Render `shaker_loop.mp4` from
the Blender pipeline and set it with a video-live-wallpaper app. Highest
visual quality by a wide margin, and completely inert — shaking does nothing.

The page already stops its animation loop whenever the document is hidden,
which is what keeps it from draining the battery while the launcher is not
showing.

## iOS

`DeviceMotionEvent.requestPermission` is gated behind a user gesture, so an
"Enable motion" button appears automatically when that API is present. iOS
does not support custom live wallpapers at all — the video loop from the
Blender pipeline, saved as a Live Photo, is the only route to the lock
screen.

## Verified

Driven headless in Chromium at a 390×844 viewport, no runtime errors, with
rest, tilt, shake and settle confirmed visually. Volume stays conserved
through a violent shake.

Measured, with a seeded PRNG and a hand-driven clock so runs are comparable:

| Property | Result |
| --- | --- |
| Frame-rate independence (2s of shaking, 30 vs 60fps) | flow energy 0.0% apart, particles 0.1px |
| Settling over 20s of stillness | mean flake moves 112px with gravity |
| Flow decay after the drive stops | RMS 570 → 26 px/s in 3s |
| Peak wave under a 3.4g shake | 44% of the amplitude cap |

Frame rate is 44-49fps at 620 flakes and 57fps at 300, measured in a
headless container with no GPU — treat that as a floor rather than a
promise, and drop `stars` if a device needs it.
