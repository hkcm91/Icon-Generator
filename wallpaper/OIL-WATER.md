# Oil and water — interactive wallpaper

A sealed cell of oil over water that fills the screen. Tilt it and the layer
finds level. Drag a finger through it and it shears, draws out filaments and
pinches them off into droplets. Shake it and the whole thing tears apart, then
rises, runs back into itself and rebuilds one layer over about twenty seconds.

One self-contained HTML file, no build step, no dependencies. Third entry in
the sealed-container line, after the [liquid shaker](./README.md) and the
[bubble wrap](./BUBBLE-WRAP.md), sharing their sensor model, their `ramp`
parameter and their `window.__shaker` host interface.

![Oil torn by a shake, with two bodies pinched off from the main mass](../docs/screenshots/oil-water.png)

Above: a second after a two-and-a-half second shake. Two separate bodies have
pinched off from the main mass and are rounding up on their way back to it.

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
| Mass drift, 75s over 6 shake-and-settle cycles | 3.6 × 10⁻¹⁰; `phi` stays inside [-1, 1] |
| Rest state | 4px/s RMS (was 126 before the two projection fixes) |
| A 2.5s shake at 2.5Hz | interface length 220 → ~1000 crossings, up to 26 separate bodies |
| Settling after that shake | back to one layer in about 20 seconds |
| Mobility set to zero | interface smears to 96% of the cell and never separates — i.e. it becomes the shaker's dye |

Cost against resolution, on a software rasteriser with no GPU. Unlike the
other two pages this is mostly **solver** work rather than drawing, so a phone
will not do dramatically better — which is why the default is 56 and not more:

| `grid` | cells | fps |
| --- | --- | --- |
| 40 | 3,480 | 60 |
| 56 (default) | 6,776 | 45 |
| 72 | 11,232 | 31 |
| 88 | 16,808 | 28 |
| 104 | 23,400 | 19 |

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
