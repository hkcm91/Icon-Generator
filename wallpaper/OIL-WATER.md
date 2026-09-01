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

### The sign of that force was wrong, and it was the whole problem

The Korteweg force is `+mu * grad(phi)` — equal to `-phi * grad(mu)` up to a
gradient the pressure projection absorbs. This shipped with the minus, which
is an *anti*-surface tension: a force that pays to make interface rather than
to remove it.

Check it on a droplet. Oil is `phi = +1` inside, so `phi` falls outward and
`grad(phi)` points inward. At the rim `mu` is about `-eps² * phi_r / r`, and
`phi_r` is negative, so `mu` is positive. Positive times inward is inward —
the Laplace pressure squeezing the drop into the smallest boundary that will
hold it. With the minus it points outward, and every bump on the interface is
a bump the force makes bigger.

Everything about how this looked followed from that one character. Blobs had
corners and spikes and long thin spears, because nothing was pulling them
round. Filaments never beaded. And the harder the coefficient was driven the
worse it got — which is why it had been tuned *down* from 900 to 300 over
several passes, each one reducing a bug rather than a parameter.

The measurement that settles it is one line: **plant a square in still liquid
and ask whether it becomes a circle.** The isoperimetric quotient `4πA/P²` is
1.0 for a circle and 0.79 for a square, so this is a number, not an opinion:

| | t=0 | 0.5s | 1s | 2s | 4s | 8s | 16s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| square, wrong sign | 0.81 | 0.82 | 0.81 | 0.76 | 0.65 | 0.51 | **0.47** |
| square, wrong sign, ×8 coefficient | 0.81 | 0.73 | 0.55 | 0.34 | 0.38 | 0.21 | **0.17** |
| square, fixed | 0.81 | 0.86 | 0.94 | **0.99** | 1.00 | 1.00 | 1.00 |
| plus-sign, fixed | 0.69 | 0.78 | 0.93 | **1.00** | 1.00 | 1.00 | 1.00 |

(With gravity switched off, so the only thing acting is the tension. Left on,
a planted square also rises and deforms, which is a different question.)

It hid for a long time, and the way it hid is the interesting part.
Allen–Cahn relaxation *is* mean-curvature flow, so the phase field rounds
shapes on its own, independently of the hydrodynamics. At the mobility this
originally shipped with, that relaxation was outrunning the bad force and the
interfaces looked plausible. Lowering the mobility while chasing fragmentation
took the cover away. So the bug was introduced on the first day and only
became visible three commits later — long after the code that contained it had
stopped being what anyone was looking at.

Two things follow that are worth keeping. First, `stats().roundness` is now a
first-class diagnostic and `__shaker.plant()` is a permanent fixture, because
the one-line statement of what interfacial tension is *for* is "it minimises
perimeter", and nothing in the page could ask that question. Second, every
constant tuned before the fix was tuned against it: the tension coefficient
has gone back up to 600, and the measurements below were all retaken.

### Conserving mass globally was deleting the droplets

The relaxation started as **conservative Allen–Cahn**: run down the free
energy at rate `-M·mu`, then subtract a single global Lagrange multiplier,
spread over the interfaces, so the total came out unchanged. It conserves the
total exactly, and it is wrong in a way that turned out to be most of why this
never looked like oil and water.

A global correction conserves mass *globally*. It does not conserve it
anywhere in particular. Mass taken off one interface reappears on another at
the far end of the cell, and because curvature flow shrinks the most sharply
curved features fastest, **the smallest droplets pay for the largest**. This
is a known failure of the formulation, described in the literature in exactly
those terms: small features dissolve into the bulk because the correction is
global.

Measured here, gravity off and nothing else acting — five planted droplets of
radii 0.28 down to 0.06:

| | t=0 | 5s | 20s | 40s | total oil |
| --- | --- | --- | --- | --- | --- |
| global Lagrange multiplier | 5 | 4 | 2 | 2 | 0.059 throughout |
| Cahn–Hilliard | 5 | 5 | 4 | 4 | 0.059 throughout |

Nothing touched them. They evaporated into each other while the books
balanced. No amount of tuning the interfacial tension could have produced a
dispersion that the bookkeeping was quietly removing.

**Cahn–Hilliard** needs no such term: `∂φ/∂t = M∇²μ` is the divergence of a
flux, so mass is conserved cell by cell by construction and a droplet can only
lose mass by transporting it to a neighbour. Small drops do still slowly feed
big ones, but that is Ostwald ripening — real physics, at a rate set by how
far the mass has to move, rather than an artefact acting at a distance. It
costs a fourth-order stability limit, `dt·M·ε²·64 < 2` on this stencil, which
caps the mobility near 1.3 at a sixtieth of a second.

### The advection was destroying the interface every step

The phase field was moved with the same first-order semi-Lagrangian step as
the velocity, and for an interface that is a disaster. Each step interpolates
bilinearly at a backtraced point, smearing a sharp boundary across a cell;
each step Cahn–Hilliard then re-sharpens whatever the smearing left. The two
fight sixty times a second, and what survives is not the shape the flow would
have produced — it is a shape repeatedly blurred and re-hardened. That is
where the frozen-in points and tendrils came from. A corner on a real
interface has enormous curvature and retracts almost at once; these survived
for ten seconds because they were being re-created faster than tension could
remove them.

It now uses **MacCormack** with a limiter — advect forward, advect back, and
half the round-trip error corrects the forward result, clamped to the range of
the four values the forward step interpolated between. Without the limiter it
rings, and a ringing phase field grows droplets out of nothing.

## Three more things that were wrong

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
| A planted square, no gravity | isoperimetric quotient 0.81 → 0.99 in 2s, 1.00 by 4s |
| A planted plus-sign, no gravity | 0.69 → 1.00 in 2s |
| Five planted droplets, no gravity, 40s | 4 of 5 survive (was 2 of 5 under the global multiplier) |
| Frame-rate independence (same impulse at 20 / 60 / 144fps) | identical oil fraction, perimeter, blob count and roundness |
| Determinism from `seed` | identical run twice; a different seed differs |
| Mass drift, 75s over 6 shake-and-settle cycles | ~10⁻⁹; `phi` stays inside [-1, 1] |
| Rest state | 2–3px/s RMS (was 126 before the two projection fixes) |
| A 2.5s shake at 2.5Hz | 18 separate bodies, still 36 after eight seconds |
| Mobility set to zero | interface smears to 96% of the cell and never separates — i.e. it becomes the shaker's dye |

**The roundness metric was itself wrong for most of this work.** It computed
`4πA/P²` over the whole oil phase at once, and for *n* identical circles that
gives `1/n` — eight perfect droplets scored 0.125 and were indistinguishable
from eight ragged ribbons. It said "not round" exactly when the simulation
started succeeding, and steering by it argued for fewer, larger blobs, which
is the opposite of what oil in water should do. It is now computed per body
and averaged with area as the weight.

| `grid` | cells | solver ms/step | fps (software) |
| --- | --- | --- | --- |
| 40 | 3,480 | 2.3 | 27 |
| 56 | 6,776 | 2.6 | 22 |
| 96 (default) | 19,968 | 7.5 | 22 |
| 128 | 31,200 | 12.6 | 19 |

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
