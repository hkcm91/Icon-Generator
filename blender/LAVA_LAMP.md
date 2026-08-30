# Lava lamp — Blender pipeline

Procedural scene builder for a lava lamp motion wallpaper: a glass column of
tinted liquid over a heated pool of wax, blobs necking off that pool, climbing,
flattening under the cool top and sinking back, rendered as a seamless portrait
loop.

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

### Presets

| Goal | Flags |
| --- | --- |
| Look-dev still | `--loop 1 --percent 25 --samples 48` |
| Motion preview | `--loop 120 --percent 40 --samples 64 --mesh-res 0.04` |
| Final loop | `--loop 240 --samples 256 --encode --device GPU` |

`--samples` and `--haze` are what the render time is made of, not `--mesh-res`
— see the note on that at the end.

## The loop closes exactly

This is the design, not a detail.

Every term of the motion is an integer harmonic of the loop length: a blob's
height, its drift, its wobble. So the state at frame `loop + 1` is the state at
frame 1 — not approximately, identically. Prove it without rendering:

```bash
$ python blender/lava_lamp.py --check-loop
[lava] 18 blobs; largest frame 1 vs frame 241 difference: 0.000e+00
[lava] loop closes exactly
```

The shaker cannot do this. Sloshing needs a fluid solver, a solver does not
return to its initial state after any finite number of frames, and so that
pipeline carries a pre-roll to settle the liquid and `--blend-frames` to
crossfade the discontinuity that is left. None of that is here: no bake, no
cache, no pre-roll, and `--blend-frames` defaults to 0. Rendering starts the
moment the scene is built.

The reason it can be done here is that wax in a lava lamp is not sloshing. It
is convecting, on a cycle slow and smooth enough to write down as a function of
time — so it is written down, and keyframed at one key per frame.

`--rise` is an integer for the same reason. Give it a non-integer and the wax
no longer returns to where it started; `--check-loop` will say so, and
`--blend-frames` is still there to cover it.

## How the wax works

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

A blob's height is a sine raised to a power below one, which flattens it near
the extremes: the blob loiters in the pool, crosses the middle briskly, loiters
under the top. That asymmetry is the read of a lava lamp — convection is slow
to start, quick in transit, slow to turn over — and `--dwell 1.0` turns it off
and gives you eleven bobbing balls.

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

**`--glow` and `--heat`** are the wax's own heat. The bulb alone falls off with
the square of the distance, so a blob at the top of a two-metre column gets
almost nothing from it; `--glow` lets the wax over the bulb self-illuminate and
`--heat` sets how far up that survives. Take `--heat` too far and every blob
glows equally, which reads as a column of paper lanterns rather than as a lamp
with a bulb in the bottom of it.

**`--depth`** is how much of the vessel's depth the wax uses, and it defaults
to 0.55 in full-bleed. A blob centred in a column that wide sits behind half a
metre of absorbing medium, and the colour it loses there is the colour the
wallpaper is made of, so the band is pulled toward the camera.

**`--palette`** picks wax, medium and metal together: `classic` (orange in
blue-violet, brass), `lagoon` (coral in teal), `toxic` (acid green in
near-black), `midnight` (magenta in indigo). Any of the three can be overridden
with `--wax-colour`, `--liquid-colour`, `--metal-colour`.

**`--blobs`, `--droplets`, `--blob-size`, `--pool`** are the population. Around
a third of the blobs never reach the top — they lift off the pool, stall in the
warm lower third and drop back, which is most of what a real lamp does — while
the droplets are the small fast beads that run the whole column.

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

Every other flag path — `--glow 0`, `--haze 0`, `--transparent`, each palette,
the colour overrides, `--droplets 0`, `--rise 2`, `--fill 1.0` — was exercised
as a scene build rather than as a render.

**Not verified here:** `--device GPU`, which needs a GPU this ran on none of,
and the `--blend-frames` crossfade, which is carried over from the shaker
unchanged and disabled by default. The Blender-install path
(`blender -b -P ...`) is the same script through the same API and was not
separately exercised — and note that the one bug this pipeline hit hardest,
the silently-flat `shade_auto_smooth`, is a `bpy`-wheel fault that a real
Blender install would not have shown. The replacement works on both.

## Known artefacts

The wax is lit, not simulated. Blobs neck and merge because the metaball field
does that for free, but nothing conserves their volume: a blob stretched at
speed is stretched by a formula, and two blobs merging make a shape with more
wax in it than either had. It reads correctly in motion and does not survive
being paused and measured.

`--mesh-res` buys less than its cost suggests. The default 0.022 puts about
8,000 vertices in the wax; 0.008 puts 62,000 there, and the silhouette is not
visibly rounder for it. Even 0.06, at 1,100 vertices, holds a clean outline —
what it loses is the small stuff, the droplets and the unevenness on the pool's
crest. Reach for it as a preview lever rather than a quality one.
