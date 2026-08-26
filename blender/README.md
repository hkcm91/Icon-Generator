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
python3 build_scene.py --target contact --still --out out/hero

# An installed Blender — this is the one you want for final renders
blender --background --python build_scene.py -- --engine eevee --target phone --animation --video --out out/loop.mp4
```

Useful flags:

| Flag | Does |
| --- | --- |
| `--spec PATH` | container spec, or a project JSON with a `spec` key |
| `--icons DIR` | directory of exported icon PNGs, applied to the tile faces in sorted order |
| `--target` | `contact`, `preview`, `phone`, `phone-1080`, `phone-pan`, `desktop`, `desktop-1440` |
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

Two details that are easy to get wrong:

- The frame range ends at `frames`, not `frames + 1`. Rendering the closing
  frame duplicates frame 1 and produces a one-frame stutter every cycle.
- The caustics evolve by walking time around a *circle* through two dimensions
  of a 4D Voronoi (`Z = r·cos 2πt`, `W = r·sin 2πt`) rather than sliding along
  W. Voronoi is not periodic in W, so a linear sweep never returns to its
  starting field and the loop point snaps.

For anything that travels one way and is replaced by a successor — bubbles,
drifting particles — use `clock.rise()` for the travel and `LoopClock.fade()`
for the opacity envelope, so the restart happens at zero alpha.

## Layout

```
build_scene.py     CLI: build, save, render
aero/spec.py       ContainerSpec — mirrors src/core/spec.ts
aero/geometry.py   the contour — ported from src/core/geometry.ts
aero/tile.py       that contour, extruded, bevelled, with a glyph plate
aero/materials.py  aqua glass, caustic backdrop, glyph face, world
aero/loop.py       phase helpers and keyframe baking
aero/render.py     engines, output targets, video settings
specs/             container specs
out/               build artifacts — gitignored
```

## Status

`--scene studio` is the look-dev rig: tiles, glass, key and fill, a caustic
backdrop, and the loop clock. It is the part every candidate wallpaper concept
needs, which is why it was built before the concept was chosen.

The wallpaper scene itself is not built yet. See `docs/AERO-WALLPAPER.md` for
the concepts under consideration and what each one adds on top of this rig.
