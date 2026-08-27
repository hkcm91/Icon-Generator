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

The liquid is a one-dimensional height field living in the gravity frame
rather than a 2-D fluid. The surface is by definition perpendicular to
gravity, and the waves run along it, so arbitrary tilt costs nothing but a
change of basis — there is no grid to rotate. It holds 60fps on a mid-range
phone with 260 flakes and 46 bubbles in flight.

Volume is conserved by feedback rather than by solving the tilted squircle's
area: each frame clips the liquid polygon against the container, measures the
area, and nudges the surface level toward the target. It settles in a few
frames and costs one shoelace sum.

Shake detection keys off *jerk*, not acceleration — gravity alone is a
constant 9.8m/s² and must never register as shaking — with device rotation
rate folded in so a twist counts too.

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
| `wave` | `0.22` | Wave propagation speed |
| `damping` | `0.985` | How fast the slosh dies down |
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

Driven headless in Chromium at a 390×844 viewport: no runtime errors, 59-61fps
sustained, and the rest, shake and settle states all confirmed visually.
Volume stays conserved through a violent shake.
