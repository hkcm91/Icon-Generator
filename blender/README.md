# Liquid shaker — Blender pipeline

Procedural scene builder for the pre-rendered half of the liquid-shaker
wallpaper: a clear squircle pouch filled with blue-to-teal liquid,
holographic star confetti and rising bubbles, baked as a FLIP fluid sim and
rendered as a seamless portrait loop.

Nothing is hand-placed. `liquid_shaker.py` builds the entire scene — geometry,
materials, particle systems, lighting, camera, the shake animation — from CLI
flags, so a change is a flag rather than a trip through the UI.

The interactive counterpart lives in [`../wallpaper`](../wallpaper). A baked
loop cannot react to being shaken; that one can. Use both.

That folder now holds three pages: the shaker's,
[`bubble-wrap.html`](../wallpaper/BUBBLE-WRAP.md), which is the same line
answering a press rather than a shake, and
[`oil-water.html`](../wallpaper/OIL-WATER.md), which answers a stir. Neither
has a baked counterpart here, for the same reason: every frame of both is a
response to where a finger was.

## Sibling scenes

A second wallpaper is built from this one's skeleton:
**[LAVA_LAMP.md](./LAVA_LAMP.md)**, a lava lamp. Same conventions, same flag
vocabulary, different liquid — and because wax convects rather than sloshes,
its motion is a keyframed metaball family instead of a fluid sim, so it has no
bake, no cache, no pre-roll, and a loop that closes exactly rather than one
crossfaded shut.

[`water_ring_toy.py`](./water_ring_toy.py) uses this file as its template —
importing its plan curve, pillow loft, fill-line boolean and render plumbing
rather than copying them — and builds the nineties handheld water ring-toss
game: a sealed water window, little plastic rings, pegs to land them on, and a
button that fires a jet of water and bubbles up through the chamber. See
[WATER-RING-TOY.md](./WATER-RING-TOY.md). Because the two share this file's
geometry, a change here lands in both, so re-render both after touching
`plan_curve`, `pillow` or `cut_above`.

## Running it

```bash
# through a Blender install
blender -b -P blender/liquid_shaker.py -- --out renders/shaker --encode

# or against the bpy module, no Blender install needed
pip install bpy==4.2.0                      # needs Python 3.11
python blender/liquid_shaker.py --out renders/shaker --encode
```

Flags go after `--` when run through Blender, and straight on argv otherwise.
`--help` lists everything.

### Look-dev without waiting for a bake

```bash
python blender/liquid_shaker.py --static --samples 96 \
  --res-x 540 --res-y 1200 --loop 1 --preroll 0 --out /tmp/look
```

`--static` skips the simulation entirely and renders the pour volume directly
as the liquid. Materials, lighting, framing and the confetti field all read
correctly in about a minute, instead of after a full bake. Both modes anchor
the liquid gradient to the shell, so what `--static` shows is what the baked
sim renders.

### Presets

| Goal | Flags |
| --- | --- |
| Look-dev still | `--static --percent 25 --samples 64 --loop 1 --preroll 0` |
| Motion preview | `--res 96 --loop 120 --percent 40 --samples 64` |
| Final loop | `--res 288 --loop 240 --samples 256 --encode --device GPU` |

Bake time scales roughly with the cube of `--res`. Start at 96 to check the
motion, then commit to a high-resolution bake once the shake reads right.

## Flags worth knowing

**`--shape fullbleed`** (default) sizes the pouch to the render aspect and
frames it edge to edge — the result is a wallpaper. `--shape pouch` gives the
product-shot framing instead: a discrete squircle floating on a backdrop.

**`--corner`** sets the corner radius as a fraction of the short side.
Full-bleed geometry is a rounded rectangle with squircle corners, not a single
superellipse, because a superellipse normalises by each half-extent — on a
1080×2400 frame that balloons the silhouette into a lozenge instead of
rounding the corners.

**`--profile-n`** controls how flat the faces are before the rim rolls over.
It defaults to 8 for full-bleed and 2.6 for the pouch, and the difference
matters: a fat rim refracts long paths through the liquid and lays dark bands
down both sides of the frame. Flat faces confine that to a narrow edge.

**`--density`** is the liquid's absorption. It trades saturation against those
same dark edges — raise it for a deeper blue, and the rim darkens with it.

**`--fill`** is the fill fraction. The air gap is what sloshes, so a value of
1.0 gives a beautiful still and no motion at all.

**`--shake`, `--tilt`** drive the motion. Both feed a gravity animation built
only from integer harmonics of the loop length, so the forcing is exactly
periodic.

## How the loop closes

Gravity is keyframed as a sum of integer harmonics over the loop, so the
*forcing* repeats exactly. The fluid state is only near-periodic — a sim does
not return precisely to where it started — so `--blend-frames` crossfades the
tail of the sequence into its head and drops the tail. `--preroll` frames are
simulated ahead of the loop window and never rendered, which lets the liquid
settle before the first visible frame.

The result wraps cleanly. During the blend there is a faint ghost, which is
the cost of closing a fluid loop without a much longer bake.

## Verified and not

Built and rendered end to end against Blender 4.2: geometry, materials,
particle instancing, lighting, camera framing, the seam crossfade, and the
mp4 encode (through Blender's own FFmpeg, so no external binary is needed).
The renders in this README's presets were produced that way.

**The Mantaflow bake is not verified here.** The `bpy` PyPI wheel ships
Mantaflow with broken Python bindings — it raises `'LevelsetGrid' object has
no attribute 'setConst'` on any domain and aborts. That is a packaging fault
in the wheel, not in this script; the bake path needs a real Blender install
to exercise. `--static` exists partly so the rest of the pipeline stays
testable without it.

## Two known artefacts

Confetti and bubbles emit from a static copy of the pour volume rather than
from the simulated liquid mesh. Mantaflow rebuilds that mesh every frame, so
particles emitted from it re-seed and flicker. Turbulence and drag give the
suspended drift instead. The flakes therefore swirl convincingly but are not
strictly carried by the fluid.

Small dark notches remain where the waterline meets the rim in the top
corners. Raising `--fill` moves the waterline out of them.
