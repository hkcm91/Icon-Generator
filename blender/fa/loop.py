"""
Seamless-loop primitives.

A live wallpaper is a video that plays frame 1 immediately after frame L,
forever. Anything that is not *exactly* periodic over L frames produces a
visible hitch once per loop, and a hitch once every ten seconds is the one
artefact a viewer is guaranteed to notice on a desktop they stare at all day.

So loopability is not something this project tunes at the end. It is a
property of how every animated value is authored:

    every animated value is a function f(t) with t = frame/L, and f(0) == f(1)

The helpers below are the only sanctioned way to animate. Each takes a
callable of phase `t` in [0, 1) and *bakes a keyframe on every frame*. Baking
every frame matters: with a key on each frame there is no interpolation
between keys, so the curve Blender plays back is bit-for-bit the function we
authored. No bezier handle at the loop boundary can smuggle in an overshoot.

Why not drivers? Two reasons. Drivers containing anything beyond Blender's
"simple expression" allowlist need *Auto Run Python Expressions* enabled, so a
driver-based .blend opens inert and wrong on someone else's machine. And a
driver is evaluated at render time, which means a render farm has to agree
with us about what `frame` means. Baked keys are just data.

`verify_loop()` at the bottom is the regression test: it re-reads the baked
f-curves and asserts the wrap-around is continuous. Run it after building a
scene, before spending an hour of GPU on a render that stutters.
"""

from __future__ import annotations

import math
from typing import Callable, Iterable, Sequence

import bpy

TAU = math.tau


class Loop:
    """The loop contract for one scene: L frames at `fps`, and nothing else.

    Everything periodic in the scene derives its timing from an instance of
    this, so changing the loop length in one place re-times the whole scene
    coherently instead of leaving half the motion on the old period.
    """

    def __init__(self, frames: int = 300, fps: int = 30):
        if frames < 2:
            raise ValueError("A loop needs at least 2 frames.")
        self.frames = int(frames)
        self.fps = int(fps)

    @property
    def seconds(self) -> float:
        return self.frames / self.fps

    def phase(self, frame: int) -> float:
        """Phase in [0, 1) for a 1-based frame number.

        Frame 1 is phase 0 and frame L+1 would be phase 1 == phase 0. The
        wrap is what makes the loop seamless, so the -1 is load-bearing.
        """
        return ((frame - 1) % self.frames) / self.frames

    def frame_range(self) -> range:
        return range(1, self.frames + 1)

    def dead_zone(self, cycles: int = 1, margin: float = 3.0) -> float:
        """A safe `dead` window for `fade_at_ends` at this loop length.

        One frame of a traveller's progress is `cycles / frames`; the dead
        zone has to be comfortably wider than that so the wrap cannot step
        across it between two frames. `margin` frames of headroom, floored at
        a value that stays visually smooth on long loops.
        """
        return max(0.04, margin * cycles / self.frames)

    def apply_to_scene(self, scene: bpy.types.Scene) -> None:
        scene.frame_start = 1
        scene.frame_end = self.frames
        scene.render.fps = self.fps


# ---------------------------------------------------------------------------
# Periodic building blocks
#
# Compose scene motion out of these rather than writing sin() inline, so that
# "is this periodic?" is answered by construction at every call site.
# ---------------------------------------------------------------------------


def wave(t: float, amplitude: float = 1.0, offset: float = 0.0, cycles: int = 1) -> float:
    """Plain sine. `cycles` must be a whole number or the loop breaks."""
    return amplitude * math.sin(TAU * (cycles * t + offset))


def wave2(t: float, amplitude: float = 1.0, offset: float = 0.0, cycles: int = 1) -> float:
    """Cosine partner of `wave`, for circular motion in a plane."""
    return amplitude * math.cos(TAU * (cycles * t + offset))


def bob(t: float, amplitude: float = 1.0, offset: float = 0.0) -> float:
    """Buoyancy: a sine with a softened top, the way a float sits in water.

    A pure sine reads as mechanical because it spends equal time above and
    below. Real buoyancy lingers at the top of the rise. Adding a half-rate
    second harmonic biases the dwell upward while staying exactly periodic,
    because both terms complete whole cycles over the loop.
    """
    base = math.sin(TAU * (t + offset))
    harmonic = 0.25 * math.sin(2 * TAU * (t + offset) + math.pi / 2)
    return amplitude * (base + harmonic) / 1.25


def travel(t: float, offset: float = 0.0, cycles: int = 1) -> float:
    """Progress along a wrapping path, in [0, 1). The shared clock for `rise`
    and `fade_at_ends`, which must agree exactly or the trick below fails.

    `cycles` is the number of complete traversals per loop and **must be a
    whole number**. A fractional speed is the subtle way to break a loop: at
    speed 0.85 the traveller is 85% of the way along when the video wraps, so
    it snaps back to the start in full view, once every loop, forever. Whole
    cycles put the wrap back exactly where it began.
    """
    if int(cycles) != cycles:
        raise ValueError(f"cycles must be a whole number, got {cycles!r}")
    return ((int(cycles) * t + offset) % 1.0)


def rise(t: float, span: float, offset: float = 0.0, cycles: int = 1) -> float:
    """Monotonic travel that wraps: bubbles ascending, clouds crossing.

    Returns a value in [0, span). The wrap is a discontinuity in the *value*,
    which is only acceptable when the object is invisible at that instant —
    see `fade_at_ends`, which is what makes the teleport unobservable.
    """
    return travel(t, offset, cycles) * span


def fade_at_ends(
    t: float,
    offset: float = 0.0,
    ramp: float = 0.15,
    cycles: int = 1,
    dead: float = 0.06,
) -> float:
    """Visibility envelope for anything animated with `rise`.

    Zero at both ends of the travel, one across the middle. Because this reads
    the same `travel` clock with the same offset and cycles, its zero lands on
    exactly the frame where `rise` wraps — so the reset is always hidden.
    Passing mismatched arguments to the two is the one way to reintroduce a
    visible pop, which is why they share this clock rather than each doing
    their own modulo.

    `ramp` is the fraction of the span spent fading at each end.

    `dead` is a hard-zero window at each end, and it is what makes the
    guarantee exact rather than approximate. A pure smoothstep only reaches
    zero at a single point, and frames land where they land — a traveller
    whose wrap falls between two frames is still a percent or two visible on
    both of them, which is small but genuinely on screen. A dead zone means
    whole frames evaluate to exactly zero, so the teleport provably happens
    with nothing drawn.

    The window must be wider than one frame's progress, or the wrap can step
    straight over it: **`dead` > `cycles` / loop frames**. Use
    `Loop.dead_zone(cycles)` to size it rather than guessing.
    """
    if ramp <= dead:
        raise ValueError(f"ramp ({ramp}) must exceed dead ({dead})")

    u = travel(t, offset, cycles)
    if u < dead or u > 1.0 - dead:
        return 0.0

    active = ramp - dead
    if u < ramp:
        return _smoothstep((u - dead) / active)
    if u > 1.0 - ramp:
        return _smoothstep(((1.0 - dead) - u) / active)
    return 1.0


def _smoothstep(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3.0 - 2.0 * x)


def circular_noise_offset(t: float, radius: float = 1.0, offset: float = 0.0):
    """A point walking a circle in noise space — the key trick in this file.

    Procedural noise is only periodic if you *sample* it periodically. Driving
    a noise texture's W input with a sine ping-pongs it: the pattern evolves
    forward then visibly rewinds, which looks like a video played backwards.

    Walking a circle through the noise field instead means the sample point
    returns to where it started having travelled continuously the whole way.
    The pattern never repeats within the loop and never reverses. This is how
    the water surface, the caustics and the aurora all animate.

    Returns an (x, y, 0) offset to add to a Mapping node's Location.
    """
    a = TAU * (t + offset)
    return (radius * math.cos(a), radius * math.sin(a), 0.0)


# ---------------------------------------------------------------------------
# Baking
# ---------------------------------------------------------------------------


def bake(
    target,
    data_path: str,
    fn: Callable[[float], float],
    loop: Loop,
    index: int = -1,
) -> None:
    """Bake a scalar function of phase onto one animatable property.

    `target` is anything with keyframe_insert: an object, a node socket, a
    material, a shape key. `fn` receives phase and returns the value.
    """
    for frame in loop.frame_range():
        value = fn(loop.phase(frame))
        _assign(target, data_path, index, value)
        target.keyframe_insert(data_path=data_path, index=index, frame=frame)
    _linearise(target, data_path, index)


def bake_vector(
    target,
    data_path: str,
    fn: Callable[[float], Sequence[float]],
    loop: Loop,
) -> None:
    """Bake a vector-valued function of phase (location, rotation, colour)."""
    for frame in loop.frame_range():
        values = fn(loop.phase(frame))
        for i, value in enumerate(values):
            _assign(target, data_path, i, value)
        target.keyframe_insert(data_path=data_path, frame=frame)
    _linearise(target, data_path, -1)


def _assign(target, data_path: str, index: int, value) -> None:
    if index < 0:
        setattr(target, data_path, value)
    else:
        getattr(target, data_path)[index] = value


def _linearise(target, data_path: str, index: int) -> None:
    """Force LINEAR interpolation on the curves we just baked.

    With a key on every frame the interpolation mode is cosmetically
    irrelevant *except* at the loop seam, where Blender's default bezier
    handles would ease in and out of the boundary and flatten one frame of
    motion. Linear keeps playback identical to the authored function.
    """
    action = _action_of(target)
    if action is None:
        return
    for curve in _curves(action):
        if curve.data_path.endswith(data_path) and (index < 0 or curve.array_index == index):
            for key in curve.keyframe_points:
                key.interpolation = "LINEAR"


def _action_of(target):
    owner = getattr(target, "id_data", None)
    animation = getattr(owner, "animation_data", None)
    return getattr(animation, "action", None) if animation else None


def _curves(action) -> Iterable:
    """Yield every f-curve in an action, across Blender 4.x and 5.x.

    Blender 4.4 moved f-curves behind slots and layers; `action.fcurves` still
    exists on 5.x but is empty for slotted actions, so falling through to the
    layer walk is required rather than defensive.
    """
    if getattr(action, "fcurves", None):
        yield from action.fcurves
        return
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            for bag in getattr(strip, "channelbags", []):
                yield from bag.fcurves


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------


def verify_loop(scene: bpy.types.Scene, loop: Loop, tolerance: float = 1e-4) -> list[str]:
    """Assert the real invariant: nothing *visible* jumps at the loop seam.

    For each curve, compare the step taken across the wrap (frame L to frame
    1) against the largest step taken anywhere inside the loop. A seamless
    curve's wrap step is in family with its interior steps; a broken one
    jumps. Comparing against the curve's own motion rather than an absolute
    threshold is what lets one test cover both a bubble drifting 8 metres and
    an alpha fade of 0.02.

    The nuance is objects animated with `rise`, which are *meant* to jump —
    they teleport back to the start of their path once per traversal. Usually
    that lands mid-loop and never touches the seam, but for some phase offsets
    it lands exactly on it. Rather than exempt those curves by name and take
    it on trust, this checks the property that actually makes the teleport
    acceptable: the object had shrunk to nothing at both ends of the wrap. A
    jump while invisible is fine. The same jump while visible is the bug, and
    is still reported.

    Returns a list of human-readable problems; empty means the loop is clean.
    """
    problems: list[str] = []

    for owner, label in _animated_ids():
        action = _action_of_id(owner)
        if action is None:
            continue
        invisible_at_seam = _is_invisible_at_seam(action, loop)

        for curve in _curves(action):
            values = [curve.evaluate(f) for f in loop.frame_range()]
            if len(values) < 3:
                continue

            interior = max((abs(b - a) for a, b in zip(values, values[1:])), default=0.0)
            seam = abs(values[0] - values[-1])
            if seam <= max(interior * 1.5, tolerance):
                continue
            if invisible_at_seam:
                continue

            problems.append(
                f"{label} :: {curve.data_path}[{curve.array_index}] "
                f"jumps {seam:.4f} at the seam "
                f"(interior steps peak at {interior:.4f}, and the object is "
                f"visible there)"
            )

    return problems


def _animated_ids():
    """Every datablock that can carry a baked action, with a readable label.

    Shader animation lives on the node tree, not on the material or world, so
    those are walked separately — a scene whose only motion is a drifting
    noise field would otherwise verify as having no animation at all.
    """
    for obj in bpy.data.objects:
        yield obj, f"object {obj.name}"
    for mat in bpy.data.materials:
        if mat.node_tree is not None:
            yield mat.node_tree, f"material {mat.name}"
    for world in bpy.data.worlds:
        if world.node_tree is not None:
            yield world.node_tree, f"world {world.name}"
    for light in bpy.data.lights:
        if light.node_tree is not None:
            yield light.node_tree, f"light {light.name}"


def _action_of_id(owner):
    animation = getattr(owner, "animation_data", None)
    return getattr(animation, "action", None) if animation else None


def _is_invisible_at_seam(action, loop: Loop, threshold: float = 1e-3) -> bool:
    """True when the object's scale is ~0 on both frames flanking the wrap.

    This is what `fade_at_ends` is for: it drives scale to zero exactly where
    `rise` teleports. Confirming it here — rather than trusting it — means a
    future edit that desynchronises the two gets caught by the build instead
    of by someone noticing a bubble flickering in the finished wallpaper.
    """
    scale_curves = [c for c in _curves(action) if c.data_path.endswith("scale")]
    if not scale_curves:
        return False

    for frame in (1, loop.frames):
        if any(abs(c.evaluate(frame)) > threshold for c in scale_curves):
            return False
    return True
