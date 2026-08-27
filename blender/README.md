# blender/ — the aqua scene

The icons are compiled from a spec. So is the scene they live in.

`build_scene.py` reads the same `ContainerSpec` the rasteriser reads, extrudes
that exact contour into glass, lights it, and animates it on a loop that closes
by construction. The `.blend` is output, not source. Delete it whenever you
like; run the builder and you get the identical file back.

## Why not just ship a .blend

Because a binary nobody can diff stops being a project after the third person
edits it. The corner-radius problem this repo exists to solve has the same
shape in 3D: if the tile is modelled by hand, its silhouette is re-decided
every time it is touched, and it drifts away from the 2D set it is supposed to
match. Reading `ContainerSpec` from both sides makes that impossible rather
than merely unlikely — `aero/geometry.py` is a port of `src/core/geometry.ts`,
same parametric superellipse, same curvature-weighted resampler, same
constants.

## Running it

Two ways, and they do the same thing:

```bash
# Blender as a Python module — works headless, no GUI, no GPU
pip install bpy
python3 build_scene.py --target preview --percent 45 --still --out out/look

# An installed Blender — this is the one you want for final renders
blender --background --python build_scene.py -- --engine eevee --target phone --animation --video --out out/loop.mp4
```

The two deliverables, once you have a GPU under it:

```bash
# phone — portrait, 1440x3120, ten seconds
blender --background --python build_scene.py -- \
  --engine eevee --target phone --icons ~/icons --animation --video --out out/loop-phone.mp4

# desktop — the same scene through the other camera
blender --background --python build_scene.py -- \
  --engine eevee --target desktop --icons ~/icons --animation --video --out out/loop-desktop.mp4
```

Useful flags:

| Flag | Does |
| --- | --- |
| `--scene` | `deepfield` (the wallpaper) or `studio` (look-dev rig) |
| `--framing` | `phone` or `desktop` camera; inferred from `--target`'s aspect if omitted |
| `--spec PATH` | container spec, or a project JSON with a `spec` key |
| `--icons DIR` | directory of exported icon PNGs, applied to the tile faces in sorted order |
| `--target` | `contact`, `preview`, `phone`, `phone-1080`, `phone-pan`, `desktop`, `desktop-1440` |
| `--bubbles` / `--rays` / `--far-tiles` | population counts in the deepfield scene |
| `--seed` | scatter seed; same seed, same scene, forever |
| `--engine` | `cycles` (CPU, works anywhere) or `eevee` (needs a GPU, ~100× faster) |
| `--frames` / `--fps` | loop length; 300 @ 30 is ten seconds |
| `--columns` / `--rows` | tile grid in the studio scene |
| `--still` / `--animation` | render one frame, or the whole loop |
| `--video` | encode straight to MP4 instead of a PNG sequence |
| `--save-blend PATH` | write the .blend so you can open and poke at it |

## Getting the icons in

The tile faces want the transparent 1024px PNGs. In the app: **Export .zip**
writes `ios/Icon-1024.png` and friends per icon. Unzip somewhere and point
`--icons` at it — files are picked up in sorted order, so the same icon lands
on the same tile every rebuild.

Without `--icons` the tiles are blank glass, which is the right state for
material look-dev.

## Engines

Cycles on CPU is the only engine that runs without a GPU, so it is what the
container and any CI box use. It is also slow: a 512px still with one tile is
around three minutes on four cores, and the full 300-frame phone loop would be
days. That path is for checking geometry and composition, not for output.

EEVEE renders the same scene in seconds a frame on a real GPU and is what the
finished loop is rendered with. The look here is stylised — a fake Fresnel rim
that no physical material has — so correct light transport buys nothing.

One EEVEE gotcha is handled in `aero/render.py`: without ray-traced or
screen-space refraction turned on, transmissive material is simply not
evaluated and every tile renders as a flat coloured card. The attribute moved
in 4.2 and again in 5.0, so each spelling is tried in turn.

## The loop

Nothing is animated by hand and nothing is cached from physics. Every animated
value is a function of a phase that completes a whole number of cycles across
the frame range, so frame N+1 *is* frame 1 and there is nothing to crossfade.
`LoopClock` enforces the integer-cycle rule and raises at build time if you
break it.

Four details that are easy to get wrong, one of which shipped broken and was
caught by measurement rather than by looking:

- The frame range ends at `frames`, not `frames + 1`. Rendering the closing
  frame duplicates frame 1 and produces a one-frame stutter every cycle.
- The caustics evolve by walking time around a *circle* through two dimensions
  of a 4D Voronoi (`Z = r·cos 2πt`, `W = r·sin 2πt`) rather than sliding along
  W. Voronoi is not periodic in W, so a linear sweep never returns to its
  starting field and the loop point snaps.
- **A travelling thing's position and its opacity must come off the same
  phase.** Bubbles first travelled on a plain two-keyframe ramp while their
  fade ran off `rise(frame, offset)`. Both closed the loop perfectly on their
  own — and closed it at *different moments*, so a bubble halfway up at full
  opacity teleported to the bottom in plain view. The phase unit tests passed
  throughout, because the phase maths was never what was wrong.
- Sampling rate has to scale with loop length. `bake_socket(step=4)` is a
  sensible economy over 300 frames and coarse enough over 24 to straddle a
  whole fade envelope, leaving a particle part-visible exactly where it jumps.
  Use `clock.sample_step()`.

For anything that travels one way and is replaced by a successor — bubbles,
drifting particles — use `clock.rise()` for *both* the travel and the
`LoopClock.fade()` envelope, so the restart happens at zero alpha. For anything
that cannot be faded, like glass, use a sine instead: it returns to where it
started without needing an envelope at all.

`tools/loop_check.py` measures this on rendered pixels rather than trusting the
maths. It compares the change across the wrap against the typical change
between neighbouring frames — a seamless loop is one where the wrap is an
unremarkable step. The bug above measured 3.13x; it now measures 0.98x.

## The scene

`--scene deepfield` is the wallpaper: a column of water with the surface
overhead and bright, the deep falling away below, shafts raking down, bubbles
rising, and tiles from the icon set drifting in the far field.

It is composed around one rule. **The icon grid sits in the darkest, quietest
band of the frame.** Bright aqua icons on a bright aqua background stop being
objects and become texture, so the wallpaper has to be the same world seen from
somewhere darker — and being underwater is the cheapest honest way to get a
bright top and a dark middle. Every number in `deepfield.py` is downstream of
that.

The far-field tiles are the part with the most obvious way to fail: squircles
behind squircles is camouflage. Four things stop it — the tiles sit far enough
back that the medium has eaten their contrast, the aperture throws them past
recognition, their angular size is held well under the real grid's, and they
are kept *above* the grid entirely, up under the surface where a launcher puts
nothing but a clock. If they ever start reading as tiles, pull `--far-tiles`
down or push the depth range out; do not "fix" it by blurring harder, because
that fights the DOF already doing the work.

Two cameras, one scene. Rendering a portrait master and cropping it for desktop
is the usual advice and it is wrong here: the composition is a *vertical* value
gradient, and a 16:9 crop either loses the bright surface or drags it down into
the icon band. The desktop camera is rolled and shifted so the brightness
gathers right, because desktop icons cluster left.

### Quiet is not the same as empty

The first art-directed version measured perfectly and looked like nothing. It
was a correctly-graded body of water with some specks in it, and a correctly
graded body of water is not the aesthetic — it is what the aesthetic looks like
once everything characteristic has been removed in the name of legibility.

Frutiger Aero is maximalist. Its vocabulary is a short list of motifs that
appear together and loudly, and `aero/motifs.py` builds them: iridescent
bubbles with a specular dot, a lens flare with coloured ghosts streaming down
frame, a swept glass ribbon with chromatic edges, tropical fish, and green weed
fringing the bottom. The composition rule did not change — the icon band is
still measured under its brightness ceiling — but "low in value" was never an
instruction to leave the frame bare, and the first pass confused the two.

Two things were tried and cut, both for the same reason: they need a bright
background and this composition cannot have one. A **bokeh field** of defocused
glowing discs turns into pale smudges against deep navy. A **caustic sea floor**
— the pool-bottom image, the most iconic in the whole aesthetic — draws a hard
horizon straight across the middle of the frame, because a floor plane's
horizon sits at eye level however deep it is; pushed far enough back for fog to
soften that, its caustics resolve into rings rather than a net, and it greyed
the dock band from 0.78 saturation to 0.37 on the way.

### Three decisions worth not re-litigating

**View transform is Standard, not AgX.** AgX is Blender's default and the right
choice for photographic work, and it is wrong for this: it deliberately
desaturates highlights, which turned every lit part of the scene grey. The
whole aesthetic is saturated and glossy. The cost of Standard is that it has no
highlight rolloff, so values have to be kept under control *in the scene* —
that is why the surface emits at 3.2 rather than 9, which was clipping to flat
white and losing every ripple.

**There is no compositor pass.** Bloom would be the obvious way to get the
glossy halo, and Blender 5.0's compositor is GPU-backed: with no GL context,
assigning `scene.compositing_node_group` makes even a pass-through group render
a blank white frame. Rather than ship an unverifiable node tree, the glow comes
from the scene itself — the scattering medium haloes bright objects because
that is what a scattering medium does.

**Place scenery by where it lands in the frame, not by world coordinate.**
`z_at`, `x_at`, `depth_for` and `place` in `deepfield.py` do the trigonometry.
Two real bugs came from not having them: weed meant to fringe the bottom edge
grew through the middle of the picture, because with a pitched camera the
centre of frame twenty units out is already six units below the lens; and the
sun, placed at a plausible-looking distance, sat just above the top edge with
its entire lens flare off-screen. Always use `place()` — it returns all three
coordinates, which is the only way to avoid passing world Y where a
camera-relative depth was wanted. That mistake put the weed seven units too
close and was invisible until measured.

**Light with red in it turns this scene grey.** The water's red channel sits
near 0.11, so an emission carrying 0.40 red nearly triples it while barely
touching blue, and the frame desaturates without ever looking brighter. The
shafts measured 0.39 saturation against water at 0.59 until their red was cut
to 0.125; they now measure 0.64. `tools/probe.py` checks this so it cannot
creep back.

## Layout

```
build_scene.py     CLI: build, save, render
aero/spec.py       ContainerSpec — mirrors src/core/spec.ts
aero/geometry.py   the contour — ported from src/core/geometry.ts
aero/tile.py       that contour, extruded, bevelled, with a glyph plate
aero/deepfield.py  the wallpaper scene: water, surface, shafts, bubbles, far field
aero/motifs.py     the Frutiger Aero vocabulary: iridescent bubbles, lens flare,
                   glass ribbon, fish, weed
aero/materials.py  glass, caustics, medium, shafts, glow
aero/loop.py       phase helpers and keyframe baking
aero/render.py     engines, output targets, colour management, video settings
specs/             container specs
tests/             geometry and loop self-checks — no Blender needed
tools/probe.py     measures a render against the composition rule
tools/loop_check.py  measures the loop seam on rendered pixels
tools/mock_homescreen.py  composites a launcher grid over a render
out/               build artifacts — gitignored
```

## Checks

```bash
python3 tests/test_geometry.py   # contour is deterministic and stays in its box
python3 tests/test_loop.py       # frame N+1 lands exactly on frame 1
```

Both run on plain Python. `spec.py`, `geometry.py` and `loop.py` import nothing
from `bpy` on purpose, so the parts that have to agree with the TypeScript — and
the phase maths the whole loop rests on — can be checked anywhere.

The unit tests are necessary and they are not sufficient: every real defect
found while art-directing this scene passed them. These three measure the
render instead.

```bash
# does the composition still hold? bright top, dark icon band, colour intact
python3 tools/probe.py out/final_phone.png
python3 tools/probe.py out/final_desktop.png --axis horizontal

# does the loop actually close, in pixels rather than in theory
python3 tools/loop_check.py out/loopseq

# what it looks like with a launcher on top — the only test that counts
python3 tools/mock_homescreen.py out/final_phone.png out/mock.png
```

`mock_homescreen.py` composites a real launcher grid over a render using
`container_ring`, so the silhouettes are exactly the ones that will sit there.
It is worth running after any change to the scene: it is the only way to see
the thing that is actually being designed, which is a *relationship* between
two images, and it has already moved the far-field tiles once.

## Status

Composed, art-directed, motif-complete and measuring clean. The phone framing profiles at 0.885
luma behind the clock falling to 0.147 behind the dock, with saturation rising
0.31 → 0.78 into the deep; the loop wraps at 0.98x an ordinary frame step; the
grid reads cleanly in the home-screen mock. A full 300-frame scene builds in
about 1.3 seconds and the .blend is under a megabyte.

Known weak points, in order: the fish are four-vertex silhouettes and look it
if anything brings them closer; the placement helpers are solved for the
*phone* camera, so motifs land differently in the desktop framing and the weed
misses it entirely; and the desktop icon column measures 0.335 against a 0.34
ceiling, which is passing but has no margin left in it.

What has *not* happened is a full-resolution render. Everything above was
judged on CPU previews at a few hundred pixels, because there is no GPU in the
environment this was built in. Two things can only be settled on real hardware:
how the surface reads at 1440x3120, where the ripple detail is currently
sub-pixel; and whether ten seconds is long enough before the eye catches the
repeat. Start here:

```bash
python3 build_scene.py --save-blend out/aero.blend   # then open it
```
