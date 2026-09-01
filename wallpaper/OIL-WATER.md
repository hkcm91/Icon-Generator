# Oil and water — interactive wallpaper

A sealed cell of oil over water that fills the screen. Tilt it and the layer
finds level. Drag a finger through it and it shears, draws out filaments and
pinches them off into droplets. Shake it and the whole thing tears apart, then
rises, runs back into itself and rebuilds one layer over about twenty seconds.

One self-contained HTML file, no build step, no dependencies. Third entry in
the sealed-container line, after the [liquid shaker](./README.md) and the
[bubble wrap](./BUBBLE-WRAP.md), sharing their sensor model, their `ramp`
parameter and their `window.__shaker` host interface.

![Rounded interpenetrating lobes of oil and water a second after a shake](../docs/screenshots/oil-water.png)

Above: a second after a two-and-a-half second shake. Every boundary is curved
and rounding itself off, with a bead of oil already pinched free into the
water — which is interfacial tension doing the only thing it does, minimising
perimeter. Before the sign of that force was fixed, the same moment came out
as spikes and spears. The light and dark bands lying across both liquids are
their surfaces being carried by the same velocity field.

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

## Oil is drops, not a field

This started as a Cahn–Hilliard phase field: an interface tracked on the grid
and advected by the flow. Four rounds of real fixes went into it — the sign of
the interfacial tension force, local mass conservation, second-order
advection, a grid fine enough to resolve a bead — and every version of it made
**ribbons**. Long curling filaments, spirals, threads.

That is not what oil does. Oil and water have high interfacial tension, so oil
makes *spheres*: they rise, they merge when they touch, they burst apart under
enough shear, and they pool. Ribbons are what miscible fluids do — ink in
water, marbling ink — and the page was drawing ink.

The field could not be made to stop, and the reason is measurable rather than
a matter of tuning. Interfacial tension is what resists stretching, and at
this grid size the coefficient needed to hold a body together against the flow
breaches the capillary time-step limit `Δt ≈ √(ρΔx³/2πσ)`: at 15,000 and
40,000 the cell stops coming to rest at all, resting RMS going 2.6 → 15.9 →
30.1px/s. Below that the flow always wins and the body always draws out.
Low-passing the velocity the bulk sees did not help either — it just made
larger spirals, because the stretching is driven by the large scales.

**A drop with a centre and a radius cannot be stretched into a ribbon.** That
is not a better tuning, it is a representation with the right behaviour built
into it — and it is the truer model at this scale. A phone-sized cell of
shaken oil and water *is* a population of drops; treating it as a continuum
interface was the error.

So the oil is now a few hundred drops:

- **Advected with Stokes drag**, response time growing as `r²`, so a big drop
  lags the water and a small one is carried by it exactly.
- **Buoyant**, with a size-independent acceleration — which with `r²` drag
  makes the rise speed go as `r²` too. That is Stokes' law, and it is why a
  shaken cell clears from the top down.
- **Coalescing**: two drops that meet become one, conserving area and
  momentum. This is the only way a drop grows.
- **Bursting**: a drop breaks in two when the local strain rate times its
  radius passes a threshold, so bigger drops break more easily — the Weber
  criterion, and why shaking makes a fine spray rather than equal pieces.
- **Packing**: drops that overlap without merging push each other apart, so a
  raft of them at the top behaves like a crowd rather than a pile.

They are drawn through the same contour and the same renderer as before, by
splatting each drop into the grid as a smooth kernel and taking the isoline of
the sum. A lone drop comes out as a circle; a raft packed at the top comes out
as one pool with a continuous surface. That is what a metaball sum is for, and
it means a settled layer and a dispersion are the same object drawn the same
way — the renderer never needs to know which it is looking at.

The kernel reach is the number that decides which. Too short and neighbouring
kernels do not sum above the threshold in the gaps between packed circles, so
a settled layer comes out as lace; wide enough and the union closes into one
surface while a lone drop still comes out at its own size, because the
threshold moves with the reach.

### The area leak

Coalescence conserves area by construction — and did not, because the radius
it conserved from was read once at the top of the loop. A drop can absorb more
than one neighbour in a single pass, and the second merge then computes the
combined area from the radius it had *before* the first, silently discarding
the first partner. Measured: 387 drops and 30% coverage went to 55 drops and
7% during one shake. Oil area now holds at 0.428 through rest, shaking, and
thirty seconds of settling.

### The shake did not reach the oil

The drops were stepped with plain gravity while the grid used the *effective*
gravity of a shaken container, `g - a`. So the water thrashed and the oil sat
in its raft and ignored it. They now share one vector.

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

Measured again after the sign fix, since the first figure was taken against a
broken force and could not be trusted: at a realistic gain a two-and-a-half
second shake at 2.5Hz moves the interface length by four per cent — 228
crossings against a resting 220 — and leaves the oil in one piece at a
roundness of 0.79, unchanged. At the shipped gain the same shake takes it to
1182 crossings, nineteen separate bodies and a roundness of 0.04.

| effective gain | peak perimeter | peak bodies | lowest roundness |
| --- | --- | --- | --- |
| 4.5 (realistic) | 228 | 1 | 0.79 |
| 20 | 256 | 1 | 0.73 |
| 60 | 562 | 8 | 0.17 |
| 180 (shipped) | 1182 | 19 | 0.04 |

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

The extracted polygons then get two passes of **Taubin smoothing**. The field
is smooth; the polygon is not — marching squares puts a vertex on every grid
edge the isoline crosses and joins them with straight segments, so the outline
picks up angular detail at the cell scale that is an artefact of the sampling
and is not in the field being sampled. Taubin rather than plain Laplacian: a
shrink pass followed by a slightly larger unshrink pass, because plain
smoothing would quietly eat the oil and this page has spent enough effort
conserving its mass not to want the renderer losing it again.

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
| `grid` | `96` | Cells across, and the most important number here. It sets the smallest droplet that can exist — an interface is about three cells wide, so a bead is never smaller than four or five — and therefore whether this behaves like two liquids at all. At 56 a shaken ribbon is seven cells across with three of them interface: no bulk to neck, so it cannot break into drops |
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
| Oil area, through rest / shaking / 30s settling | 0.428 throughout — exactly conserved |
| Roundness of the oil bodies | 0.59 at rest, 0.38 mid-shake, 0.69 settled (it was 0.07–0.13 as a field) |
| Drops surviving a 2.5s shake | 333 → 294 → 245 over thirty seconds, by coalescence |
| Rest state | 0.3px/s RMS |
| Ribbons, filaments, spikes | none possible: a drop is a centre and a radius |

| `grid` | cells | fps (software rasteriser) |
| --- | --- | --- |
| 96 (default), ~300 drops | 19,968 | 25 |

The solver column is the one that transfers to a phone; the fps column is a
software rasteriser doing full-screen blending, which is the single thing a
GPU is best at. At 96 cells a step costs 7.5ms, leaving about 9ms of a
sixtieth of a second for everything else.

## Where this actually stands

It still does not look like oil and water, and the reason is a three-way
squeeze that every fix has made more visible rather than less. All three
sides were measured today:

- **First-order advection** smears the interface and Cahn–Hilliard re-hardens
  the smear, freezing in points and tendrils that a real interface would
  retract in milliseconds.
- **Second-order advection** removes the smearing, and the flow immediately
  stretches the interface into hair-thin threads. Threads only break into
  drops when they are several interface-widths thick, and the interface is
  about three cells at any resolution affordable here — so they simply keep
  thinning. Thirty-six stringy bodies instead of two blobby ones is a
  different failure, not a better result.
- **Enough interfacial tension to stop them thinning** breaches the capillary
  time-step limit, `Δt ≈ √(ρΔx³/2πσ)`. At a coefficient of 15,000 and 40,000
  the cell stops coming to rest at all: resting RMS goes 2.6 → 15.9 → 30.1.

The way out of all three at once is three to five times the grid, which is ten
to twenty-five times the solver cost. That is not available in JavaScript at
sixty frames a second on a phone, and no further tuning of the constants will
substitute for it.

What is here is correct and measured — the tension force points the right way,
mass is conserved locally, the advection is second order, the interface is
resolved as well as the budget allows — and the result is still not
convincing. Those are compatible statements, and the honest reading is that
this particular liquid is the wrong one to have picked for a coarse real-time
solver.

**It has never run on a handset.** Same caveat as the other two, and for the
same reason: there is no device here.

## What the line wants next

**Slime**, and this page is the argument for it. Everything the solver does
badly here it would do well there. Slime is viscous, shape-holding and slow;
it has no droplets to resolve, no threads to bead, and no capillary time-step
to breach. The coarse, gooey, smooth-formed behaviour that is wrong for water
is exactly right for a gel — which means the constraint that defeated oil and
water is not a constraint there at all.

It wants a shear-thinning, yield-stress constitutive law in place of the
Newtonian viscosity, so the material holds its shape until pushed hard enough
and then flows, and it wants *dragging* as its verb — a finger that stretches
the material rather than pressing or stirring it. The viscous term here is
already written as a diffusion, which is precisely the term a non-Newtonian
law replaces.
