# Oil and water — interactive wallpaper

A sealed cell of oil over water that fills the screen. Tilt it and the layer
finds level. Drag a finger through it and it shears, draws out filaments and
pinches them off into droplets. Shake it and the whole thing tears apart, then
rises, runs back into itself and rebuilds one layer over about twenty seconds.

One self-contained HTML file, no build step, no dependencies. Third entry in
the sealed-container line, after the [liquid shaker](./README.md) and the
[bubble wrap](./BUBBLE-WRAP.md), sharing their sensor model, their `ramp`
parameter and their `window.__shaker` host interface.

![Oil wound into a vortex a second after a shake, both liquids showing flow sheen](../docs/screenshots/oil-water.png)

Above: a second after a two-and-a-half second shake. The oil has been wound
around an eddy and is rounding itself off again; the light and dark bands
lying across both liquids are their surfaces being carried by the same
velocity field, which is where most of the "this is liquid" comes from.

## Try it

Open `oil-water.html` in a browser and drag to stir. On a desktop, where there
are no sensors, **shift-drag** or the **arrow keys** stand in for tilting the
phone and **space** or **S** shakes it.

## What the plan said, and what was actually true

The note at the end of the bubble wrap's write-up said this one was nearly
free — that the shaker already carried a denser second phase, so oil and water
was a colourway and a tuning pass on a file that already exists.

That was wrong, in one specific and load-bearing respect. The shaker's second
phase is a **dye**: a scalar advected by the flow, given buoyancy, with
nothing in it that says two fluids cannot mix. It marbles. Marbling is exactly
right for a glitter shaker and is the one thing oil and water never do.
Immiscibility is not a tuning constant; it is a term in the equation of
motion, and the file did not have it.

The rest of the estimate held up. The velocity solver, the shake model, the
sensor handling and the colourway system all came across nearly unchanged.
It was the one sentence about the second phase that was doing all the damage.

## How two fluids refuse to mix

The dye is replaced by a **phase field**: `phi` running from -1 (water) to +1
(oil), advected by the flow, and relaxing under a free energy with two wells:

```
f(phi) = (phi² - 1)² / 4  +  (eps²/2)|grad phi|²
```

The double well is what separates them. Every intermediate value is uphill, so
a half-mixed cell rolls to one side or the other; there is no stable state in
between, which is what "immiscible" means. The gradient term is what stops the
interface collapsing to nothing and gives it a width of about three cells.

The variation of that energy is the chemical potential

```
mu = (phi³ - phi) - eps² lap(phi)
```

and `mu` does two jobs. Relaxing `phi` down its own gradient separates the
phases and holds the interface width. Feeding `mu * grad(phi)` back into the
momentum equation **is** the interfacial tension force — in the form that does
not require knowing the curvature of anything.

That second half is where the visible behaviour comes from, and it is worth
being precise about how little is written down. **Roundness, coalescence and
pinch-off are not three features.** They are one force, and it points the same
way in all three cases: toward less interface. A droplet is round because that
is the shortest boundary around its area. Two that touch merge because one
boundary is shorter than two. A filament drawn out by shear beads up because a
row of spheres has less surface than a cylinder. Nothing in this file knows
what a droplet is.

The check that this is really what is happening: set the mobility to zero, so
the field advects but never relaxes, and the page becomes the shaker's dye
again — measured, the interface smears across 96% of the cell and never
separates. The relaxation is the immiscibility, and nothing else is.

**Mass has to be conserved and Allen–Cahn does not conserve it.** Left alone
the oil quietly evaporates, smallest droplets first, which on a wallpaper
means the thing empties itself over an afternoon. The fix is a Lagrange
multiplier chosen so the total change is zero, spread over the interfaces
rather than uniformly — `(1 - phi²)` is nearly zero in the bulk of either
fluid, so the correction nudges boundaries instead of tinting whole regions.
Measured over seventy-five seconds and six full shake-and-settle cycles, the
conserved mean drifts by 3.6 × 10⁻¹⁰.

## Three things that were wrong

All three presented as the same symptom — the cell never came to rest — and
none of them were what that symptom looked like.

**The buoyancy force had a non-zero mean.** The oil is 42% of the cell, so
`phi` averages -0.15 rather than 0, so a force proportional to `phi` has a net
uniform component. A uniform force is precisely the thing a pressure
projection cannot remove, because it is already divergence-free. So it
survived every step and accelerated the entire body of liquid until viscosity
balanced it: a permanent 126px/s drift that no amount of damping or vorticity
tuning touched, because neither was causing it. Buoyancy is measured against
the mean density, not against zero; the missing term is the container pushing
back with the net weight of what it holds. **126 → 113px/s.**

**The pressure was cleared every frame.** Two fluids of different densities in
layers need a pressure field varying across the whole height of the domain to
hold them up. That is the lowest spatial frequency there is, and a relaxation
method is at its worst on low frequencies: eighteen Gauss–Seidel sweeps carry
information eighteen cells, and the grid is a hundred and fifty-six tall.
Started from zero each frame the solve never got close, and the leftover
buoyancy drove a permanent circulation. Warm-starting costs nothing — the
hydrostatic field is nearly the same from one frame to the next, so the solver
refines an answer it already has instead of rediscovering it, and the
divergence is recomputed from scratch anyway so a stale pressure can only be a
better initial guess than zero. **113 → 4px/s.** That is one deleted line.

**Viscosity was a decay, and a decay cannot do this job.** The job has two
halves that pull against each other: shaking has to fragment the layer, which
needs the flow to survive long enough to fold it, and settling has to take
tens of seconds, which needs droplets to rise slowly. One decay constant
cannot be both small and large, and every value tried was either a shake that
did nothing or an emulsion that unmixed itself in two seconds.

Diffusion is not one constant. Damping goes as `nu·k²`, so bulk flow is
long-wavelength and barely feels it while a droplet's flow field is as small
as the droplet and is damped hard. The speed a droplet rises at settles to
force over damping, which — because damping goes as `k²` — is proportional to
the square of its radius. **That is Stokes' law, and it arrived by writing the
viscous term down properly rather than by being asked for.** It is also why a
shaken bottle clears from the top down: the big drops go first.

## The one number that is a lie

`SHAKE_GAIN` is 180: each g of hand motion is worth a hundred and eighty g of
effective gravity. It is named in the source rather than buried, because it is
worth being straight about which part of this is physics.

A completely full, sealed, rigid cell of oil and water, shaken by a real hand
at a real two or three g, does very nearly nothing. That is not a failing of
the model — it is why you shake a bottle that has air in it. With no headspace
the only forcing is the effective gravity acting differentially on the two
phases, and with the real density difference of oil and water, about a tenth,
that forcing is weaker than the buoyancy already holding the layer together.

Measured, at a realistic gain a two-and-a-half second shake at 2.5Hz moved the
interface length by twelve per cent. Dropping the interfacial tension by a
factor of ten did not change that, which is the useful part of the result: the
drive was nowhere near the instability threshold, so lowering the threshold
was not the answer, and no amount of tuning the other constants was going to
be either.

So the gain is dialled far above life, deliberately. What it buys is the thing
the product is for. What it costs is a claim nobody should read as a
measurement.

One real thing did fall out of testing it: **the response is far more
sensitive to frequency than to amplitude.** A 2.5Hz shake fragments the layer
where a 4.5Hz shake at the same gain barely marks it, because this is a
parametric (Faraday) instability and it needs time within each half-cycle to
grow. A hand shakes a phone at about two to three hertz, so the resonance is
in the right place by luck rather than design.

The finger needs no help. Dragging through a liquid really does impose your
own velocity on it, so the stirring is honest at gain 1 — and it is a drag
rather than a push outward, because a radial source is pure divergence and an
incompressible fluid cannot expand away from a poke. The projection deletes
all of it. (Measured in the shaker, where the same mistake was made first.)

## Drawing a liquid that has an edge

The field is 56 cells across and the screen is 393. Drawing it as an image and
letting the compositor interpolate gives a soft cloud, and soft is the one
thing an oil droplet is not — the characteristic read of oil in water is a
hard edge with a bright line of refraction sitting on it.

So the `phi = 0` isoline is extracted as actual polygons by marching squares,
and everything after that is drawn at full resolution with gradients, strokes
and clips. Contouring is one pass over the grid and it buys a crisp silhouette
that no amount of upscaling can.

Two details that make it robust rather than nearly-working:

- **Crossings are keyed by which grid edge they lie on**, not by their
  coordinates, so linking segments into closed loops is exact integer
  bookkeeping instead of hashing floats and hoping.
- **The field is extended by a ring of water** before contouring. Without it,
  a layer of oil spanning the whole cell produces an open contour that runs
  off two edges and never closes, and an open path cannot be filled. With it,
  every loop closes off-screen and the visible area is still covered edge to
  edge.

The segments are directed so oil is always on the left of travel, which makes
the winding consistent, which makes a hole in a blob fill as a hole under the
nonzero rule instead of as more oil. `stats().drawnArea` is the renderer
checking itself against the solver — the contour is a separate representation
of the same field, so a case-table error shows up as the two disagreeing
rather than as something subtle found later on a phone.

## Making it look like a liquid, which took three goes

The crisp silhouette was necessary and nowhere near sufficient. The first
version filled the contour with a gradient running down the *screen* and drew
a hairline around it, and the verdict on it was blunt and correct: it did not
look like liquid at all. It looked like cut paper — which is exactly what was
drawn. A flat colour field bounded by an outline is what a paper cutout *is*.
Nothing in the picture varied with the shape of the thing it was painting, so
nothing in it could say "body of liquid" rather than "region".

The second version went the other way and stacked six translucent washes —
inner shadows for thickness, a light flank, a dark flank, a caustic halo — and
turned the oil brown. Six semi-transparent layers each carrying a different
idea average to mud, and the additive halo read as a sticker glow.

What was actually missing was not inside the blob at all. Three things were,
and two of them were bugs rather than matters of taste.

**Every highlight on the page was sub-pixel.** The strokes were specified as
fractions of a cell, and a cell is about seven CSS pixels — so `cell * 0.055`
is four tenths of a pixel. The meniscus, the wet line, the rim: all of them
were being drawn at widths that cannot appear. There was no bright mark
anywhere in the frame, and **a picture of a liquid with no specular in it is a
picture of a piece of paper.** Fixing that alone did more than every wash in
the second version put together.

**The velocity field was not being drawn.** The page had a full fluid solver
and the only evidence of it on screen was that the silhouette changed shape.
A still liquid is a mirror; a moving liquid is a mirror being bent, and the
bright and dark bands sliding across it are the single most recognisable thing
about the material.

So the surface got a height field of its own: a noise texture that is
**advected by the same flow that carries the oil**, shaded by dotting its
gradient into the light. Stir the cell and the ripples wind into the eddies,
because they are being carried by the velocity field, not drawn on top of one.
It is pulled slowly back toward a standing pattern as it goes, because
advection is dissipative and a long shake would otherwise leave a dead mirror
behind.

Four things about that took measurement rather than judgement:

- **A sum of sine products is a crosshatch.** The first standing pattern was
  two sinusoids multiplied, which tiles the plane in a regular diamond grid.
  It read as woven fabric laid over the liquid. Value noise on a lattice,
  three octaves, fixed it.
- **Nothing finer than about four cells.** The field is stretched sevenfold on
  the way to the screen, so an octave near the grid's Nyquist limit does not
  become fine detail — it becomes visible cell-sized blocks.
- **The gain cannot be a constant.** Measured, the 90th percentile of the
  relief signal is 0.11 in a resting cell, 49 while it is being shaken, 2.8
  two seconds later and 0.4 after ten. Four orders of magnitude. Both fixed
  values tried were wrong at one end: too high and everything clipped to the
  rails, leaving only the one-cell transition between them, which upscaled
  into a staircase and read as a contour map; too low and the surface went
  flat again. It is normalised against a slow running average of its own
  magnitude instead, and saturated smoothly rather than clipped, because a
  hard clamp puts a crease everywhere the field crosses the rail.
- **Contrast and amplitude are different questions.** Normalising to a
  constant contrast gave a resting cell the same heavy mottling as a churning
  one, and a resting cell then read as sponged plaster — because still liquid
  is not textured at all. The field supplies the shape; the amount of motion
  in the cell supplies the amplitude. At rest that leaves a whisper of sheen.

On top of the relief there is a **glint** pass: the slope raised to a high
power, so only the steepest few per cent survive, added rather than blended so
it can go brighter than anything else in the frame. A lighten-and-darken pass
is symmetric and a real surface is not — the crests that happen to face the
lamp send it straight back at you and everything else does not, which is why
water reads as a scatter of small very bright marks rather than an even
modulation.

That pass also found a real bug in the solver's boundary handling. `bounds()`
carried the velocity and the phase field across the wall ring but not the
ripple, and since advection only writes the interior, the ring kept its seeded
values while the inside evolved away from them. The relief saw a cliff one
cell wide all the way round the cell, and the glint, being a high power of the
slope, turned that cliff into a blown-out white border. Anything defined on
the grid has to come across the boundary, not just the parts that obviously
move.

## Options

Append as query parameters, e.g. `oil-water.html?oil=0.6&tension=0.4`.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `mode` | `full` | `full` fills the screen; `pouch` floats a squircle on a backdrop |
| `grid` | `56` | Cells across. The dial that matters for cost, and what sets the smallest droplet that can exist — an interface is three cells wide, so a bead is never smaller than four or five |
| `oil` | `0.42` | Oil as a fraction of the cell. Past about two thirds the water is the minority phase and the emulsion inverts, which is real and looks odd |
| `ramp` | shaker's blue | The water, along the gravity axis. Same parameter and same default across all three pages |
| `tint` | `#e8806c` | The oil. Ember Glow — the two phases have to differ in *hue*, or the separation the physics works so hard at is invisible |
| `tension` | `1` | Interfacial tension. Low is ragged and slow to round up; high snaps everything to circles and the shake gets no purchase |
| `buoyancy` | `1` | Density difference. At 0 the fluids weigh the same, they never separate, and shaking does literally nothing |
| `visc` | `1` | Momentum diffusivity, which sets how fast droplets rise |
| `glass` | `0` | 0 is opaque water (a wallpaper); 1 drops the water so an icon shows the home screen through the cell |
| `seed` | `20260831` | Names a cell: the same seed gives the same starting interface and the same sequence of shakes |
| `n` / `scale` | `4` / `0.78` | Corner squareness and size, `pouch` mode only |

## Verified

Driven headless in Chromium at 393×852 with the clock stubbed before the
page's own script runs, so no real frame ever steps the solver and a run is
reproducible from the first tick.

| Property | Result |
| --- | --- |
| Frame-rate independence (same impulse at 20 / 60 / 144fps) | identical oil fraction, perimeter, blob count and RMS |
| Determinism from `seed` | identical run twice; a different seed differs |
| Mass drift, 75s over 6 shake-and-settle cycles | 8.2 × 10⁻¹⁰; `phi` stays inside [-1, 1] |
| Rest state | 4px/s RMS (was 126 before the two projection fixes) |
| A 2.5s shake at 2.5Hz | interface length 220 → ~1000 crossings, up to 26 separate bodies |
| Settling after that shake | back to one layer in about 20 seconds |
| Mobility set to zero | interface smears to 96% of the cell and never separates — i.e. it becomes the shaker's dye |

Cost against resolution, on a software rasteriser with no GPU:

| `grid` | cells | fps |
| --- | --- | --- |
| 40 | 3,480 | 27 |
| 56 (default) | 6,776 | 22 |
| 72 | 11,232 | 19 |
| 88 | 16,808 | 15 |

Read that table sideways: doubling the cell count costs about a third of the
frame rate, which means **most of the cost is not the solver**. It is the
full-screen composite that draws the relief, and a full-screen blend costs the
same whether the grid under it has forty cells or ninety. Drawing the relief
and the glint as two separate blended passes halved the frame rate on its own
— 13fps against 22 — which is why they now ride in one map.

That also means this number understates a phone by more than the other pages'
do. Blending one full-screen layer is the single thing a GPU is best at and
the single thing a software rasteriser is worst at; the solver, which is plain
JavaScript arithmetic either way, is the part that transfers honestly. The
flat first version of the renderer ran at 45fps here and looked like cut
paper, which is the trade being made.

That resolution is also the honest limit on what this can be. At 56 cells the
smallest droplet is five or six cells across, which is a centimetre-scale blob
and not the micron-scale one that makes a real emulsion last for minutes. This
is a lava lamp, not a vinaigrette, and it is a lava lamp because of the grid.

**It has never run on a handset.** Same caveat as the other two, and for the
same reason: there is no device here.

## What the line wants next

**Slime** is the one still outstanding, and it is now clearly the most
interesting of the three: the shaker's solver with a shear-thinning,
yield-stress constitutive law in place of a Newtonian viscosity, so the
material holds its shape until you push hard enough and then flows. It wants
*dragging* as its verb — a finger that stretches the material rather than
loading it or stirring it — which is a third thing the line does not have.

Two pieces of this page transfer directly to it. The phase field is how you
say where the slime is and where the air is, and the viscous term is already
written as a diffusion, which is the term a non-Newtonian law replaces: make
`nu` a function of the local strain rate and most of the rheology follows.
