# Lava lamp — Blender pipeline

Procedural scene builder for a lava lamp motion wallpaper: a glass column of
tinted liquid over a heated pool of wax, blobs charging against that pool,
necking off it, coasting up on stored heat and sinking back as they lose it,
rendered as a seamless portrait loop.

The motion is integrated, not drawn. Buoyancy, drag, heat transfer and the
liquid's own convection roll are solved per blob before a single keyframe is
written, and the dwell at the top of a climb is the time the wax takes to cool
rather than a number anyone chose.

Nothing is hand-placed. `lava_lamp.py` builds the entire scene — vessel,
materials, the wax, lighting, camera, every keyframe — from CLI flags, so a
change is a flag rather than a trip through the UI.

Built from [`liquid_shaker.py`](./liquid_shaker.py), which is the same idea for
a different liquid, and it is worth knowing where the two part company. See
[the shaker's README](./README.md) for that pipeline, and
[`../wallpaper`](../wallpaper) for the interactive counterpart.

## Running it

```bash
# through a Blender install
blender -b -P blender/lava_lamp.py -- --out renders/lava --encode

# or against the bpy module, no Blender install needed
pip install bpy==4.2.0                      # needs Python 3.11
python blender/lava_lamp.py --out renders/lava --encode
```

Flags go after `--` when run through Blender, and straight on argv otherwise.
`--help` lists everything.

### Look-dev

```bash
python blender/lava_lamp.py --loop 1 --percent 25 --samples 48 --out /tmp/look
```

There is no simulation to wait for, so a single frame at quarter resolution is
the whole look-dev loop: about six seconds for `--shape lamp`, about thirty for
`--shape fullbleed`, which has a great deal more scattering medium in front of
the camera. What that frame shows is what the sequence renders.

`--loop 8` is worth knowing as a second look-dev mode: eight frames sample the
whole convection cycle evenly, so it is a storyboard of the motion for the cost
of eight stills.

### Presets

| Goal | Flags |
| --- | --- |
| Look-dev still | `--loop 1 --percent 25 --samples 48` |
| Cycle storyboard | `--loop 8 --percent 20 --samples 32` |
| Motion preview | `--percent 15 --samples 20` |
| Final loop | `--samples 256 --encode --device GPU` |

`--samples` and `--haze` are what the render time is made of, not `--mesh-res`
— see the note on that at the end.

The two motion presets leave `--loop` alone on purpose, because the physics
sets it. That means around 740 frames, and there is no honest way to make it
many fewer: see below.

## How the wax moves

Per blob, before anything is keyframed, this integrates:

- **Stokes drag, with no inertia in the state at all.** The Reynolds number
  here is about 0.01 and the momentum relaxation time `2ρr²/9μ` is a fraction
  of a second against a cycle of tens of seconds, so a blob is at its terminal
  velocity essentially always. Carrying momentum would add two stiff variables
  and change nothing you could see.
- **Buoyancy from thermal expansion.** The wax is denser than the medium when
  cool and lighter when hot, crossing over at `--neutral`. `--lift` is the
  whole density swing, and it is a few kg/m³ because that is the truth of the
  object: a lava lamp works because its two liquids are within about a gram
  per litre of each other.
- **Lumped-capacitance heat transfer** toward the liquid's vertical
  temperature profile, with the time constant `--lag`, shortened while the
  blob is in contact with the pool.
- **An axisymmetric convection roll** — up the middle, out at the top, down
  the walls, in across the floor — taken from a Stokes stream function so the
  field is divergence free. A roll that did not conserve volume would quietly
  pump wax into one corner of the bottle over a loop this long.

### Why it oscillates at all

This is the part worth understanding before changing `--heat` or `--neutral`,
because the obvious version of this model does not oscillate.

Give the liquid a gentle temperature gradient and a blob spirals into the
height where its density matches the medium, and stops there — damped, at
rest, forever. The linearised system has negative trace and positive
determinant; it is a stable spiral, and no amount of tuning the gradient
changes that. It is a perfectly good simulation of a lava lamp nobody has
switched on.

What sustains the cycle is that **the bulk of the column sits below the
neutral temperature**. Then the only place a blob can become buoyant at all is
in contact with the pool. It charges there, coasts upward on stored heat,
loses that heat, and sinks back for more — a relaxation oscillator, whose
period is set by `--lag` rather than by how fast anything travels.

So `--heat` has to stay *short*. Lengthening it warms the bulk, raises the
neutral crossing, and hands the blobs a mid-column equilibrium to settle into;
past about 0.25 the lamp stops cycling and becomes a still life. This is
counterintuitive enough to be worth stating plainly: more heat makes the lamp
climb *less*.

### What comes out of it

Reach is an outcome, not a setting. With a real lamp's speeds — around 19 mm/s
— a blob's coast carries it about two thirds of the way up the modelled
bottle, and no further, because coast distance is roughly `0.34·v·τ` and that
is what those numbers give. That band is then rescaled onto the rendered
column above the pool line, so the shape and the timing are untouched and only
the ruler changes.

The size behaviour falls out too, and it inverts what you would guess. Speed
goes as r² and so does nothing else here, so large blobs travel fast; but
small wax cannot store enough heat to climb, while being light enough for the
roll to carry it. The beads therefore ride the current *higher* than the blobs
do. Nobody arranged that.

## The loop closes exactly

Every blob's period is snapped to the nearest `loop / k` for integer k, so the
sequence wraps with nothing to hide. Prove it without rendering:

```bash
$ python blender/lava_lamp.py --check-loop
[lava] medium 14.0 cP; a 8mm blob at full heat rises 18.6 mm/s
[lava] 19 blobs, 19 of them reaching past mid-column; loop 743 frames = 61.9s
[lava] wax used 68% of the modelled bottle; that band is stretched to fill it
[lava]     blob_0  r= 5.7mm  natural  69.4s  x1 per loop  tops out at 73%
[lava] 19 blobs; largest frame 1 vs frame 744 difference: 0.000e+00
[lava] loop closes exactly
```

Snapping is the one place the loop constraint overrides the physics, and it is
worth being plain about rather than hiding: only the *rate* is quantised. The
shape of the motion — the charge, the coast, the hover, the fall — is the
integration untouched. `--loop 0`, the default, sets the loop to the median
natural period, which is what keeps most of those stretches near 1.0; anything
worse than 1.35× is printed as a warning.

The shaker cannot do this at all. Sloshing needs a fluid solver, a solver does
not return to its initial state after any finite number of frames, and so that
pipeline carries a pre-roll to settle the liquid and `--blend-frames` to
crossfade the discontinuity left over. None of that is here: no bake, no cache,
no pre-roll, and `--blend-frames` defaults to 0.

## A slow lamp needs a long loop

There is no way around this one and it is better stated than discovered.

The wax takes about 50 seconds to come round. A seamless loop must contain a
whole number of those cycles, so the loop is about 50 seconds long — and at
any sane frame rate that is a lot of frames. Asking for a 4-second loop of
50-second motion is asking for something that does not exist; what you get
instead is 50-second motion played twelve times too fast, which is what this
pipeline did before the physics went in.

Two things make it affordable:

- **`--fps` defaults to 12.** Wax moves at millimetres per second. At the
  default framing a blob covers about five pixels per frame at 12fps, so the
  result is indistinguishable from 30fps and costs 60% less to render. This is
  the single best lever here and it costs nothing.
- **`--lag` scales the whole clock.** Halve it and halve `--viscosity` with it
  and the period halves while every trajectory keeps its shape, because coast
  distance goes as `v·τ` and that product is unchanged. `--lag 10 --viscosity
  0.007` gives a 25-second cycle that still moves like wax.

## How the wax is built

The wax is a Blender **metaball family**: objects whose names share a base
(`Lava`, `Lava.001`, `Lava.002`) are polygonised into one surface. A blob
approaching the pool therefore necks into it, and two blobs meeting merge and
part, with no code for either — the field does it. That is the whole reason
metaballs are the right tool here and a mesh with a shrinkwrap is not.

Three things about that family are worth knowing before changing anything:

- **`Lava` itself is the basis.** It supplies the resolution, the threshold,
  the material and the coordinate space every other member is measured in, so
  it stays at the origin with an identity transform. It carries the one part of
  the wax that never moves: the pool.
- **The members are animated by object transform, not by element.** Keyframing
  element positions inside one metaball datablock is the documented trap; those
  properties animate unreliably and do not always evaluate at render time.
  Object location and scale always do.
- **An element's `radius` is its influence, not its size.** Blender's falloff
  is `stiffness · (1 − d²/r²)³`, so at the default stiffness and threshold a
  ball renders at `0.575` of its radius. Everything that has to touch a wall —
  the pool ring, a blob's clearance from the glass — measures with that number.
  Place the pool off the influence radius instead and the outer lumps hang
  straight through the bottle.

## Flags worth knowing

**`--shape fullbleed`** (default) oversizes the column so its walls and both
its ends fall outside the frame: what is left on screen is liquid, wax and
light, which is a wallpaper. **`--shape lamp`** frames the whole object — base,
bottle, cap — as a product shot.

**`--density`** and **`--haze`** are both optical depths *across the width of
the vessel*, not raw absorption coefficients. That normalisation is what lets
one number mean the same thing in both shapes, when the full-bleed column is
more than twice the diameter of the bottle and would otherwise swallow the wax
in fog at the same setting.

`--density` is absorption: it tells you what is behind the liquid. `--haze` is
scattering, and it is what tells you the liquid is *lit* — it carries the bulb
up into the medium as a glow that falls off with height. It is also the
expensive half of the render; `--haze 0` is much faster and much flatter.

**`--glow` and `--glow-reach`** are the wax's own light. The bulb alone falls
off with the square of the distance, so a blob at the top of a two-metre column
gets almost nothing from it; `--glow` lets the wax over the bulb
self-illuminate and `--glow-reach` sets how far up that survives. Take it too
far and every blob glows equally, which reads as a column of paper lanterns
rather than as a lamp with a bulb in the bottom of it.

`--glow-reach` is deliberately *not* tied to `--heat`, even though both are
about heat and it is tempting. `--heat` is the liquid's temperature profile and
has to stay short or the lamp stops cycling; the glow should extend well past
it, because wax carries its heat upward as it climbs.

**`--depth`** is how much of the vessel's depth the wax uses, and it defaults
to 0.55 in full-bleed. A blob centred in a column that wide sits behind half a
metre of absorbing medium, and the colour it loses there is the colour the
wallpaper is made of, so the band is pulled toward the camera.

**`--palette`** picks wax, medium and metal together: `classic` (orange in
blue-violet, brass), `lagoon` (coral in teal), `toxic` (acid green in
near-black), `midnight` (magenta in indigo). Any of the three can be overridden
with `--wax-colour`, `--liquid-colour`, `--metal-colour`.

**`--blobs`, `--droplets`, `--blob-size`, `--pool`** are the population. Sizes
are held in a narrow band on purpose: velocity goes as r², so a population
spanning a factor of two in radius spans a factor of four in speed, and the
large ones tear up the column while the small ones sit still. The droplets are
the deliberate exception, and what they do is the model's decision rather than
a setting — see the size inversion above.

**`--viscosity`, `--lift`, `--lag`, `--neutral`, `--circulation`** are the
physics, and `--lag` is the one to reach for first: it sets the period, while
`--viscosity` sets the speed. Change both together in the same direction to
retime the lamp without reshaping it. `--circulation` should stay well under
0.5 — past that the roll stops perturbing the wax and starts carrying it, blobs
become passive tracers, and the buoyancy cycle stops being what you are
looking at.

## Why the top of the frame goes black

The upper column has almost nothing lighting it. The bulb is metres away by
then and falling off with the square of that distance; the wax's own glow has
run out; and the medium absorbs. Three things were compounding it, and only
one was obvious:

- **The absorption gradient ran the wrong way.** A volume absorption node's
  colour is what it *transmits*, so tinting it darker toward the top means the
  top absorbs more — applied to the part of the frame that already had the
  least light. It clears with height now instead.
- **`--glow-reach` was short**, so blobs above 45% of the column had no
  self-illumination at all and went to dark maroon.
- **`--crown` was far too low.** In full-bleed this light, above the column
  and pointing down it, is the *only* source the top of the frame has. It is
  the single biggest lever on that half of the picture, and it now defaults to
  14× the bulb rather than 2.2×.

Measured on the same frame, mean luminance over the top 30% of the frame went
from 0.098 to 0.179. Turning `--crown` off entirely gives 0.054, which is what
the top of the frame looks like with nothing lighting it at all; `--crown 25`
gives 0.195 and starts to flatten the lamp's gradient.

## Two lights, and nothing in front of the glass

The lamp lights itself: a warm point source under the pool, and everything else
in the rig exists only to keep the vessel from disappearing into a black frame.
In `lamp` that is a cool key at camera-left and a rim behind. In `fullbleed` it
is a single crown light above the column, pointing down it.

There is deliberately no frontal fill in full-bleed, and the reason is worth
recording because it cost an hour. The camera looks through a metre-wide
refracting cylinder; a source on the near side comes back through it, painted
across the frame as a soft vertical bar. Switching the light out of camera rays
does not remove it, and neither does switching it out of glossy rays, because
the path that carries it is transmission. The fix is not a flag. It is not
putting a light there.

The backdrop has a matching trap. Its radial gradient falls off over one unit
of object space while the panel is nine metres across, so left unmapped it is a
one-metre hotspot dead behind the column — which refracts into a bright bar
down the middle of the wallpaper and looks exactly like the light that is not
there any more.

## Do not use `bpy.ops.object.shade_auto_smooth`

It is a wrapper that appends a bundled "Smooth by Angle" node group from
Blender's essentials asset library, and the `bpy` wheel does not finish loading
that library. The call returns `FINISHED` having done nothing. There is no
exception to catch, no warning in the log that names it, and the mesh is left
entirely flat.

The vessel is a refractor, so that is not cosmetic. Every facet of a flat-shaded
lathe bends light its own way, and the wax behind it grows a comb of short dark
hairs along its silhouette — one tooth per facet column, which is why the hairs
are vertical. It reads unmistakably as a metaball problem. It survives finer
`--mesh-res`, uniform blob scale, more samples, denoising off and a raised
shadow-terminator offset, because it was never in the metaballs at all: the same
comb appears with the glass alone and with the medium alone, and disappears with
both removed.

`shade_auto_smooth()` in this file does the job with plain mesh operators —
smooth everything, select edges by angle, mark them sharp — and then asserts
that some face actually came back smooth, because the failure mode of the thing
it replaces was to claim success.

## Verified and not

Built and rendered end to end against `bpy` 4.2 on Python 3.11, headless, on
CPU: geometry, the solidified glass shell, the metaball family and its
polygonisation, both shapes, both framing paths, the wax and medium shaders,
the seam check, the mp4 encode through Blender's own FFmpeg, and `--save-blend`.
`--check-loop` reports an exact zero.

The physics was tuned against the integrator directly rather than through
renders — periods, climb heights and speeds read out of `--check-loop`, which
runs the whole model in about six seconds and never opens Cycles.

Every other flag path — `--glow 0`, `--haze 0`, `--transparent`, each palette,
the colour overrides, `--droplets 0`, `--fill 1.0` — was exercised as a scene
build rather than as a render.

**Not verified here:** `--device GPU`, which needs a GPU this ran on none of,
and the `--blend-frames` crossfade, which is carried over from the shaker
unchanged and disabled by default. The Blender-install path
(`blender -b -P ...`) is the same script through the same API and was not
separately exercised — and note that the one bug this pipeline hit hardest,
the silently-flat `shade_auto_smooth`, is a `bpy`-wheel fault that a real
Blender install would not have shown. The replacement works on both.

## Known artefacts

The blobs do not know about each other. Each one is integrated alone in the
bottle, so nothing stops two of them occupying the same place — they merge,
because the metaball field merges anything that overlaps, but they merge by
coincidence rather than by collision, and they pass through one another as
readily as they join. Adding the interaction would couple every blob to every
other, and a coupled system has no per-blob period to snap to, which is what
the exact loop is built on. The per-blob station in `blob_state` is the cheap
stand-in for it.

Volume is not conserved either. A blob stretched at speed is stretched by a
formula standing in for the capillary number, and two blobs merging make a
shape holding more wax than either brought. It reads correctly in motion and
does not survive being paused and measured.

The wax is also modelled as a rigid sphere for drag purposes while being
rendered as a deformable drop. A real drop of this size circulates internally
and follows Hadamard–Rybczynski rather than Stokes, which is a correction of
order one — it would change the constants, not the character.

`--mesh-res` buys less than its cost suggests. The default 0.022 puts about
8,000 vertices in the wax; 0.008 puts 62,000 there, and the silhouette is not
visibly rounder for it. Even 0.06, at 1,100 vertices, holds a clean outline —
what it loses is the small stuff, the droplets and the unevenness on the pool's
crest. Reach for it as a preview lever rather than a quality one.
