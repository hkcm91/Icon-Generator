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
the fluid cannot pile up against a wall, so it has to roll. The walls are
no-slip — a viscous glitter gel grips the glass, and that boundary layer is
what sheds the vortices that make a shake swirl rather than merely slosh
back and forth.

**A free surface** — a one-dimensional height field in the gravity frame,
so arbitrary tilt costs only a change of basis. Waves are gravity-capillary:
`omega^2 = gk + (sigma/rho)k^3`, so wave speed scales with the in-plane
component of gravity (which is what provides the restoring force) while
surface tension stiffens the short wavelengths. It is coupled to the fluid
beneath it, which is what gives the waterline structure; driven by the tilt
term alone it can only ever be a straight line.

The surface is bounded by the vessel that holds it. The drawn meniscus is
bisected to its true contact point on the glass and given a capillary climb
there, rather than being stroked across the full tangent span — near the top
the container has already curved inward, and a surface drawn past that got
chopped off by the glass, reading as a clipping artefact across the frame.

Because the shaker is nearly full, the interface is split into segments: the
crest may press against the ceiling, and where it does there is no
air-liquid boundary at all, so the waterline genuinely breaks around the
trapped air and the pocket migrates to whichever corner is highest. The
crest bound is asymmetric for the same reason — upward it stops at the
ceiling, downward there is a whole body of liquid to draw from.

It is drawn as a band rather than a line. The pouch has depth, so the
surface is seen almost edge-on and presents a band lit along its lower edge
by light piping through the wedge of liquid beneath it. A hairline read as a
stroke drawn on top of the picture.

**Two-way coupling** — particles push back on the liquid, not just the other
way around. One-way advection is the usual shortcut and it misses the most
characteristic thing a glitter shaker does: settling flakes drag liquid down
with them, the displaced liquid rises somewhere else, and the suspension
organises into slow convection plumes. With no input at all the flow field
sustains 17-19 px/s of almost purely structural motion; before the coupling
it was exactly zero.

**A second, denser liquid** — carried as a passive scalar on the same grid
and advected by the same velocity field. The reference has a teal ribbon
curling through the blue, and it is not a painted gradient: it is a second
liquid that has not fully mixed. Giving it a density difference is what
makes it behave — it sinks, stratifying into a green-teal layer low down,
and a shake tears that layer into Rayleigh-Taylor fingers. The colour
gradient stops being decoration and becomes a consequence of stratification.
Measured: settled it separates to 0.01/0.96, a shake mixes it back to 0.68,
and the mean is conserved across both.

**Particles with Stokes drag** — response time and terminal velocity both
scale with radius squared, so fine glitter traces the flow almost exactly
while big flakes lag, overshoot on a turn and sink faster. That spread is
what makes a settle look like a real suspension rather than one moving
sheet. Flakes flutter as they sink; bubbles rise with buoyancy against drag.

Flakes also disperse down their own concentration gradient. A suspension
does not let particles pile up indefinitely — collisions and the disturbance
flow around each flake drive a flux from crowded regions to empty ones.
Without it the convection cells preferentially concentrate the flakes and
they band against the top and bottom: measured at a 2.2x spread between the
fullest and emptiest tenth of the container, brought down to 1.4x.

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
| `fill` | `0.965` | Fraction of the container holding liquid. The ullage is what sloshes — at `1` nothing moves |
| `n` | `4` | Corner squareness: 2 circular, 4 squircle, 8 nearly square |
| `corner` | `12%` of the short edge | Corner radius in pixels (`full` mode) |
| `stars` | `620` | Confetti count |
| `bubbles` | `52` | Bubble count |
| `scale` | `0.78` | Container size against the short edge (`pouch` mode only) |

Drop `stars` to about 300 and `bubbles` to 30 on a low-end device; the
fluid solver's cost is fixed, so the particle count is the dial that matters.

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
| Capillary term stability | no non-finite values in surface or flow after a 2.3g shake |
| Settling convection with zero input | 19 px/s flow, ~100% of it spatial structure rather than drift |
| Dense-phase stratification | separates to 0.01/0.96 settled, mixes to 0.68 shaken, mean conserved |
| Flake distribution evenness | 2.2x top-to-bottom spread without dispersion, 1.4x with |

Frame rate is 44fps at 620 flakes, measured in a
headless container with no GPU — treat that as a floor rather than a
promise, and drop `stars` if a device needs it.
