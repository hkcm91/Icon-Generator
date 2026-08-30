# Milk — a translucent 3-D blob, as an interactive wallpaper

A single soft body of a milky scattering medium, raymarched in a fragment
shader, that sags under gravity and wobbles when the phone is moved. One
self-contained HTML file, no build step, no dependencies.

The [liquid shaker](./README.md) next to it is a 2-D fluid seen side-on through
glass. This is the other half of the idea and a different problem, because
almost everything you recognise about milk happens *inside* it rather than at
its surface.

## Try it

Open `milk.html` in a browser. On a phone it uses the real sensors; on a
desktop, drag to tilt, flick to shake, click to poke.

It needs WebGL 2, and it needs an `https://` origin for the motion sensors —
the same constraint the shaker has, and for the same reason. The wake lock, the
fullscreen-on-first-touch and the runtime manifest all work the way they do
there; [that README](./README.md#on-a-phone) explains why each is needed.

## The technique

### The body is a distance field

Six spheres, smooth-unioned with the usual polynomial `smin` and sphere-traced.
One is a core, big and nearly still; the rest orbit far enough out to read as
lobes. Satellites tucked inside the core give a shape that is an ellipsoid at
every moment, which throws away the only reason to use metaballs at all — that
the silhouette itself changes.

They cannot come away from it. The furthest a satellite gets from the core in
sixty seconds of hard shaking is 0.58 units, against the 0.65 at which the two
would stop overlapping, and the blend radius covers a good deal more than that
margin again. So the body is always one connected thing.

### The material is a participating medium, not a surface

This is the whole look, and it is the part a surface shader cannot fake.

The camera ray refracts into the body and a second march measures how far it
travels before it leaves. That thickness is the one number everything hangs
off. A surface shader — however soft its falloff, however wrapped its diffuse —
has no idea how much material is behind the pixel, so its thin edges are
exactly as dense as its middle, and that reads as an opaque marble every time.

Marching from inside is the same sphere trace running the other way: the field
is negative in there, so `-map(p)` is the distance to the boundary and stepping
by it is exactly valid.

**Scattering and absorption are separate coefficients, and keeping them
separate is the whole reason the body has a colour.** Milk scatters almost
neutrally — that is why it is white — and absorbs selectively. So the
scattering coefficient is grey and only the absorption carries the tint,
inverted out of the palette's deep colour. Extinction is their sum; the
single-scattering albedo, which is the colour the medium sends back to the eye,
is their ratio.

Folding the tint into extinction alone is the obvious thing to write, and it is
what this did first. The light then comes back out white however deep it went,
so the colour exists only in what the *backdrop* loses passing through — it
survives as a thin fringe at the silhouette and nowhere else, and the body is
porcelain. Fixing it swung too far the other way at first, for a different
reason, which is the next point.

**Where the transition falls matters more than what the colours are.** The
in-scattering is the single-scattering integral for a uniform source, in closed
form: `albedo * J * (1 - exp(-sigma*T))`. Both of its limits are the thing
being drawn. Where the path is short, `1 - trans` goes as `sigma*T`, the
extinction cancels against the albedo and what is left is neutral haze — so a
thin edge stays white whatever the tint. Where it is long the exponential dies
and what is left is the albedo, which is the deep colour. The ramp between them
is not painted anywhere; it is the geometry's own thickness.

Which means the density is not a free parameter. It has to put that transition
inside the range of thicknesses the body actually presents — about 1.4 units
through the middle and nothing at all at the silhouette. Set too high, every
pixel is already at the asymptote and the result is a flat wash of the deep
colour with no white in it anywhere; too low and the transition never starts
and it is a soap bubble.

**Multiple scattering is wrapped, and that is the honest answer here.** In a
dense medium light does not stop at the terminator: it enters the lit side,
bounces a few dozen times and leaves somewhere round the curve. That is why
milk and wax and skin have no hard shadow edge. Remapping `N.L` from -1..1
rather than clamping it at zero is the cheap stand-in, and at this density the
mean free path is short enough that a real solve would come back looking much
the same.

**Light also comes through from behind**, killed by thickness, strongest where
the eye is looking along the light's own direction of travel. That lights the
rim and the thin lobes and nothing else, and it is the other half of
translucency — the half that is usually missing.

### Two failures worth keeping

**The rim was a drawn outline.** Fresnel goes to one all the way round the
silhouette, so if what the surface reflects is bright in every direction, the
result is a uniform white line traced round the body. It looks like a stroke
laid on top of the picture. The environment is still lifted clear of the
backdrop — reflecting only what is visible behind the camera makes the rim
*darker* than the body, which is backwards and reads as painted rubber — but
the lift is small, and nearly all of the brightness at the rim now comes from
two directional lobes, which vary along it.

**It had no position, only a size.** The backdrop is sampled by direction
alone, which puts it at infinity, and something floating in front of an
infinite gradient is nowhere in particular. So for the primary ray the backdrop
is given a plane to live on and the balls are tested against the light ray from
the point where the camera ray crosses it. It is the real balls rather than a
blurred ellipse underneath: the shadow changes shape as the body does,
stretches when it stretches and swings across the backdrop when it is shaken,
without being animated.

### The backdrop is a function of direction, not of screen position

That is what lets one function serve the pixels around the body, what is seen
*through* it after refraction, and what it reflects. Written in screen space it
could not: refracting a ray would sample a backdrop that does not exist
anywhere off screen, and the body would show a copy of the wallpaper rather
than a view through itself. The scale factor in that mapping is not free — it
is the one that makes it agree with screen space along the primary ray, so the
backdrop beside the body and the backdrop behind it are the same picture rather
than two gradients that happen to meet at the silhouette.

### The silhouette is antialiased out of the march

A sphere trace already knows how close it came, so a ray that misses by less
than a pixel is a partly covered pixel rather than a missed one. The closest
approach is tracked as an angle, compared against the angular width of a pixel,
and the near-misses are shaded at the closest point and blended. Supersampling
the frame to get the same edge would cost the entire render again.

## How it moves

**Gravity is a standing deformation**, and this body is hanging rather than
resting on anything — so it is a pendant drop, drawn out along the gravity
axis, not a sessile one squashed across it. Since the deformation is volume
preserving it narrows by the same token.

That is the formulation's doing rather than a choice: the deformation is
carried as one vector whose length is the amount, and a length is never
negative, so the axis can only ever be stretched. Expressing the other case
would take a signed amount and a decision about how to combine a squash on one
axis with a stretch on another, and there is nothing in the scene for the body
to rest on to justify either.

The strength follows the in-plane component of gravity rather than a normalised
direction, which is what makes a phone lying flat show a round blob and a phone
held upright a drawn-out one. Measured: `|wobble|` 0.160 upright, 0.000 flat on
a table.

**Shaking is a transient.** In the non-inertial frame of a body being carried
about, its contents feel `-a`. Sign is the whole point: force it with `+a` and
the blob leads the phone, which no physical object has ever done. The body
stretches along the direction it is being dragged and the spring runs it out
over about a second — peak 0.450 (the cap), 0.247 half a second later, back to
its resting 0.160 within two.

**Six springs, not one.** One spring for the whole body would have been less
code and would have got the lurch — the body arriving a moment after the phone
does — and nothing else. Six of different stiffness give the thing an inside: a
shake reaches the small lobes first and the core last, so the form ripples
through itself on the way back to rest instead of translating rigidly and
stopping. Stiffness scales as `1/r` for the honest reason, that a small lobe
has less mass hanging off the same restoring force.

**The squash is volume preserving**: stretch by `s` along the axis, squeeze by
`1/sqrt(s)` across it. A body that changed volume as it wobbled would read as
breathing rather than as jelly. It is applied by warping the sample point
through the *inverse* of the deformation, which deforms the shape by the
deformation itself — and because an anisotropic scale does not preserve a
distance field, the result is multiplied by the smaller of the two scale
factors. Without that conservative bound the trace overshoots wherever the body
is squeezed and the silhouette breaks into notches.

**A twist about the viewing axis** carries the orbits round with it, so
spinning the phone stirs the form rather than merely tilting it. The
home-screen offset moves the camera, which is parallax, and separately shoves
the body, because being dragged sideways is being dragged sideways whether a
hand or a launcher is doing it. A tap dents the body inward at the point struck
and bulges it across, which is the volume-preserving squash again, given an
impulse.

### Fixed timestep

The simulation runs on a fixed 1/60s tick with an accumulator, for a reason
specific to springs rather than for tidiness: semi-implicit Euler has a
stability limit and a damping behaviour that both depend on the step, so a
variable step makes the jelly stiffer at 120fps than at 30 and can make it
leave the screen on a dropped frame.

Measured by settling identically, poking the body and then stepping the same
input at 30Hz and 60Hz: the deformation state — which is what you actually see
— is identical to five decimal places, and the ball positions agree to 0.0125
units, about 1.4% of the body radius. That residue is the sub-step phase the
accumulator leaves behind rather than a divergence, and the way to tell the two
apart is to keep going: over thirty seconds it settles to 0.0105 rather than
growing.

One thing it is worth being straight about. Hold the *frame* rate fixed and
vary the *sensor* rate instead and the two runs do differ, by about twice that,
because the gravity low-pass is per sample rather than per second. In practice
Android delivers the accelerometer at its own cadence whatever the renderer is
doing, so this is not the same axis — but it is a real dependence, and it is
inherited from the shaker's motion model rather than introduced here.

## Options

Append as query parameters, e.g. `milk.html?tint=lilac&q=1`.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `tint` | `cream` | `cream`, `rose`, `mint`, `lilac`, `blue` |
| `q` | device, capped at 1.25 | Render scale. **The dial that matters on a phone** |
| `balls` | `6` | Metaballs. The second dial that matters |
| `density` | `1.0` | Where the white-to-deep transition falls |
| `smooth` | `0.24` | Metaball blend radius. Higher is rounder and less lobed |
| `steps` | `72` | Sphere-trace iterations |
| `inner` | `20` | Interior march iterations, which measure thickness |
| `seed` | `20260830` | Metaball sizes, orbits and phases |

## What it costs

Sphere tracing is fill-rate bound: the cost is linear in the number of pixels
and in the work done per pixel, and it does not care how large the body is on
screen. So the two dials are `q` and `balls`, and `steps` is not one — the
march exits early nearly everywhere.

Measured at 390×844 in the container's software rasteriser, which has no GPU:

| | Frame |
| --- | --- |
| Default | 133ms |
| `q=0.6` (234×506, 36% of the pixels) | 50ms |
| `balls=3` | 82ms |
| `steps=48&inner=14` | 124ms — inside the noise |

**These are not device numbers and should not be read as any.** The shaker's
README makes the same point about its own: what dominates here is a full-screen
canvas being rasterised in software. A fragment shader of this shape is
ordinary work for a phone GPU, but nothing in this repository has run it on
one, so treat the ratios above as the useful part and the absolute numbers as
an artefact of where they were taken.

Two things did make a real difference and are worth knowing:

**The bounding sphere is measured, not assumed.** Rays that miss it skip the
march entirely, which is most of the screen. Sizing it for the worst case the
balls could reach — 2.30 units — when the body normally sits inside 1.06 does
not merely fail to cull a handful of pixels: every ray passing anywhere near
the body runs the full march between the two intersections, so thousands of
background pixels march a corridor that was empty all along. Computing it each
frame from where the balls actually are took the frame from 171ms to 128ms.

**The shadow runs for every pixel of backdrop on the screen**, so its
perpendicular miss distance is kept squared and never rooted.

## Getting it onto an Android home screen

The same three routes the shaker documents, with one difference: the
`WallpaperService` in [`../android`](../android) hosts this page as well.

Both pages are copied into the APK's assets by the build, and both present the
identical `window.__shaker` interface — same methods, same units, same device
frame — so the service does not need to know which one it is running. Which one
it hosts is `wallpaper_page` in `android/app/src/main/res/values/strings.xml`,
and a query string is allowed there:

```xml
<string name="wallpaper_page">milk.html?tint=lilac</string>
```

That page swap has not been built or run here — this container has no Android
SDK — so it is code-reviewed rather than verified. The APK build itself needed
one change to go with it: the service now reads a string resource, which is the
first `R` reference in the source, and the Gradle-free `tools/build-apk.sh` had
no step generating `R.java`.

## Verified

Driven headless in Chromium at 390×844, 412×915 and 844×390, no runtime errors
in any of them, with rest, drift, tilt, shake, tap and home-screen scroll each
confirmed visually. All five palettes rendered and checked.

Measured, with a seeded PRNG and a hand-driven clock so runs are comparable:

| Property | Result |
| --- | --- |
| Frame-rate independence, 30 vs 60Hz | wobble identical to 5 d.p., balls within 0.0125 units |
| …and it does not drift | 0.0125 at 2s, 0.0112 at 5s, 0.0105 at 30s |
| Gravity sag tracks the in-plane component | \|wobble\| 0.160 upright, 0.000 lying flat |
| A shake rings out | peak 0.450, 0.247 at 0.5s, 0.160 (rest) by 2s |
| The body never comes apart | furthest satellite 0.58 units from the core over 60s of shaking, against 0.65 to separate |
| The bounding sphere is worth measuring | 1.06 at rest, 1.34 mid-shake, against a 2.30 worst case |
| …and what that bought | 171ms → 128ms per frame |

The one thing not measured is how it runs on a phone.
