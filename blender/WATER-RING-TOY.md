# Water ring toy — Blender pipeline

The handheld water game from the nineties, built as a seamless phone-portrait
loop for a live wallpaper: a coral case, a sealed water window, little plastic
rings, pegs to land them on, and a button on the chin that fires a jet of water
and bubbles up through the chamber and throws the rings around.

Nothing is hand-placed. `water_ring_toy.py` builds the whole scene — geometry,
materials, the ring motion, the button presses, the jet, the bubbles, the
lighting and the camera — from CLI flags, so a change is a flag rather than a
trip through the UI.

![A frame from the loop, fourteen frames after a press](../docs/screenshots/water-ring-toy.png)

Above: fourteen frames into a press. The bubble column is still coming off the
nozzle over the button, the rings in the bottom have been stirred, and the pink
ring has just been lifted off its peg.

It is built on [`liquid_shaker.py`](./liquid_shaker.py) and imports its plan
curve, pillow loft, fill-line boolean and render plumbing directly rather than
copying them, so a fix to that geometry is a fix to both scenes.

## Running it

```bash
# through a Blender install
blender -b -P blender/water_ring_toy.py -- --out renders/ringtoy --encode

# or against the bpy module, no Blender install needed
pip install bpy==4.2.0                      # needs Python 3.11
python blender/water_ring_toy.py --out renders/ringtoy --encode
```

Flags go after `--` when run through Blender, and straight on argv otherwise.
`--help` lists everything.

### Look-dev without waiting

```bash
python blender/water_ring_toy.py --static --loop 1 --preroll 0 \
  --percent 25 --samples 64 --out /tmp/look
```

`--static` skips the motion entirely and renders the opening pose: some rings
already on pegs, the rest settled in the bottom of the chamber. Materials,
lighting, framing and the whole colour story read correctly in about fifteen
seconds.

### Presets

| Goal | Flags |
| --- | --- |
| Look-dev still | `--static --loop 1 --preroll 0 --percent 25 --samples 64` |
| Motion preview | `--loop 130 --preroll 30 --presses 1 --percent 30 --samples 32` |
| Final loop | `--loop 240 --preroll 90 --samples 256 --encode --device GPU` |

The motion itself costs almost nothing — the rings are integrated in Python in
well under a second. Everything you wait for is Cycles.

## How it moves

**One button, one jet.** A press drops the button into the chin, opens a wind
field in a column above the nozzle, releases a burst of bubbles into it, and
raises a swell on the surface a few frames later. All four read the same
envelope, `jet_level()`, so the bubbles are *in* the push rather than
decoration on top of it. `--buttons 2` gives the two-button variant of the toy
and presses alternate between the nozzles.

**The rings are integrated here, not by Bullet.** This is the one real
departure from the shaker, and it is worth being plain about why. A ring is a
body with a hole in it, and the whole point of the toy is putting that hole
over a peg — which is the one thing a rigid-body solver will not do here:

- a convex hull has no hole, so the ring is a disc and cannot be threaded;
- a concave triangle mesh is not supported for a moving body, and the ring
  sinks through the floor;
- a compound of beads following the stock, which is the shape that *would*
  work, is silently dropped — parenting the beads to the ring they describe
  is a dependency cycle, Blender reports `Detected 16 dependency cycles` and
  the ring ends up with no collision shape at all. Measured: a ring dropped
  onto a bar rests on it with `CONVEX_HULL` and falls 34 metres through it
  with `COMPOUND`.

So `simulate_rings()` integrates them: apparent gravity, water drag, the jet
column, a slow periodic drift, separation from each other, the chamber walls,
and a latch that catches a ring on a peg when it drifts over one slowly and
lets go when a jet hits it harder than `--release`. Every term is something
you can point at in the render, and being ours it is deterministic — the same
seed gives the same loop every time, with no cache to bake.

**Catching is judged on screen.** The camera is orthographic and dead-on, so a
ring is on a peg exactly when the peg appears inside its hole. `--catch` is
therefore measured in the screen plane, with a separate depth test for whether
the ring is near enough to be threaded at all. That is the same question the
viewer is answering.

**The pegs lean out of the back wall** by `--hook-tilt`. A peg pointing
straight at an orthographic camera is a dot; leaning it up gives it a length
to read and gives a ring something to hang on. They also drift on their
stalks — `--hook-bob` — because a wallpaper is looked at for a long time and a
board that is perfectly rigid behind moving water reads as a painted backdrop.
The float is computed by one shared function so the keyframer and the solver
cannot disagree about where a peg is.

**Peg proportions come off the ring, not off the peg.** `--hook-fit` is the
shaft as a fraction of the ring's hole and is the slop in the joint;
`--hook-grip` is the knob, which is what a ring has to climb over to leave by
the front. The collar that stops it leaving by the back is wider than the hole
by construction — a collar narrower than the hole is not a stop, it is a ramp.

## How the loop closes

Every source of motion is periodic by construction:

- **The jet** is keyed only at its own breakpoints and is exactly zero
  everywhere else, so there is no residual forcing at the seam.
- **The bubbles** come in bursts that start and finish inside the loop.
  `--quiet` reserves a tail long enough for the last bubble of the last press
  to expire, and is raised automatically if you set it too short. Between
  presses the chamber is genuinely empty of bubbles, which is also how the toy
  behaves.
- **The surface ripple** is a slow swell at an integer harmonic of the loop
  plus per-press spikes keyed to zero on both sides. Its texture is nailed to
  the world and the *mapping object* moves on a sinusoid, so the pattern
  returns exactly rather than scrolling.
- **The pegs** bob on integer harmonics.
- **The rings** are rewound: over the last `--rewind` frames each is eased
  back toward the pose it held on the first rendered frame — position lerped,
  orientation slerped, with the weight short of 1 on the final frame so it
  steps *into* the first rather than duplicating it.

Measured across all nine rings at the default settings, the seam gap is at
most 0.2 mm of translation and 0.0° of rotation. The shaker's pixel crossfade
is therefore off by default here (`--blend-frames 0`); it exists only for the
case where you set `--rewind 0`, and on hard-edged plastic rings it would
show you two of each.

A ring drifting a few centimetres over two seconds is what rings in water do
anyway, which is why the rewind survives being looked at.

## Flags worth knowing

**`--bezel`** is the opaque frame as a fraction of case width, and it also
sets how big the button can be, since the button lives in the chin.

**`--fill`** is the water level. The air gap at the top is where the jet
breaks the surface, so 1.0 gives you a beautiful still and no splash.

**`--density`** is the water's absorption, and it is a tint rather than the
colour of the toy. The blue you see is mostly the backing plate: a real one of
these holds about a centimetre of water, which tints almost nothing, and the
field the rings are seen against is a sheet of coloured plastic at the back.
Crank the density and every ring becomes a silhouette, because the light that
reaches one has crossed the volume twice.

**`--plate`** glows the backing plate slightly. It is lit from the front
through the water, so without it it arrives dimmer than the rings in front of
it and the picture inverts.

**`--jet` and `--jet-wind`** are the same envelope in different units: the
first is the upward acceleration a ring feels on the jet axis, the second is
the strength of the field the bubbles ride. **`--jet-spread`** is the one to
reach for if a press looks like nothing happened — too narrow a column only
moves what is directly over the hole.

**`--drift`** is the residual swirl in a chamber nobody has touched for a
minute. Turn it off and the rings only ever move in the screen plane, so they
never change depth and never line up with a peg.

## Colour space

Every palette entry in the script is written in sRGB and converted by `lin()`
on the way into a shader socket. Handing them over raw is the quiet way to
lose a palette: sockets are linear, so a mid-saturation coral arrives as pale
pink and reads as a lighting fault rather than a colour-space one. If you pass
`--case-colour`, pass sRGB.

## Verified and not

Built, simulated and rendered end to end against `bpy` 4.2: geometry, the
window boolean, materials, the ring solver, the peg latch, the bubble bursts,
the surface ripple, lighting, camera framing, the seam measurement, the frame
sequence, the crossfade path and the mp4 encode through Blender's own FFmpeg,
so no external binary is needed. The images in this repo's history were
produced that way.

**Not verified:** GPU rendering (`--device GPU`) — there is no GPU here, and
the device-selection code is inherited from the shaker unchanged.

## Known artefacts

Blender prints `Failed to add relation "Animation -> Rigid Body"` for the jet
objects on every depsgraph rebuild. It is an animated force field in a scene
with no rigid-body world; nothing in this scene wants one. The message is
cosmetic and the field animates correctly.

A ring can only be caught by a peg that is free. Two rings never share one,
which is right, but it does mean a chamber with more rings than pegs will
always have rings loose in the bottom — which is also the toy.
