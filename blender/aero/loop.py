"""
Seamless loop timing.

A live wallpaper plays forever. Every hour of it is the same few seconds, so
the single most visible defect in the whole project is a hitch at the loop
point — and it is the one defect that is invisible while you scrub the
timeline and obvious the moment it runs on a phone.

The fix is structural rather than corrective. Nothing in the scene is animated
by hand or by a physics cache. Every animated value is a function of a phase
that completes a whole number of cycles across the loop, so frame N+1 *is*
frame 1 by construction and there is nothing to blend, trim or crossfade.

    clock = LoopClock(frames=300, fps=30)     # 10 seconds
    clock.sine(frame, cycles=2)               # two full bobs per loop
    clock.phase(frame, cycles=1, offset=0.3)  # a bubble 30% up its rise

`cycles` must be an integer. That is the whole discipline; the assert exists so
that breaking it fails at build time rather than at 3am on someone's lockscreen.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class LoopClock:
    """Maps a frame number onto phases that close perfectly over the loop."""

    frames: int
    fps: int = 30

    @property
    def seconds(self) -> float:
        return self.frames / self.fps

    def phase(self, frame: int, cycles: int = 1, offset: float = 0.0) -> float:
        """
        Position within the cycle, in 0..1.

        `frame` is 1-based, matching Blender's frame numbering, so frame 1 sits
        at phase `offset` and frame `frames + 1` would land back on it.
        """
        _require_integer(cycles)
        return ((frame - 1) / self.frames * cycles + offset) % 1.0

    def sine(self, frame: int, cycles: int = 1, offset: float = 0.0, amp: float = 1.0) -> float:
        """A sine that completes `cycles` whole oscillations across the loop."""
        return amp * math.sin(self.phase(frame, cycles, offset) * math.tau)

    def rise(self, frame: int, cycles: int = 1, offset: float = 0.0) -> float:
        """
        A 0..1 ramp that resets at the loop point.

        Use for anything that travels one way and is replaced by an identical
        successor — bubbles, drifting particles, a scrolling caustic. The reset
        is only invisible if whatever uses it also fades in at 0 and out at 1;
        `fade` below is the matching envelope.
        """
        return self.phase(frame, cycles, offset)

    @staticmethod
    def fade(t: float, edge: float = 0.15) -> float:
        """
        Smooth 0 -> 1 -> 0 envelope over t in 0..1, flat through the middle.

        Pairs with `rise` so a particle is at zero opacity at both ends of its
        travel and the restart cannot be seen.
        """
        if edge <= 0:
            return 1.0
        if t < edge:
            x = t / edge
        elif t > 1.0 - edge:
            x = (1.0 - t) / edge
        else:
            return 1.0
        return x * x * (3.0 - 2.0 * x)


def _require_integer(cycles: int) -> None:
    if cycles != int(cycles) or cycles < 1:
        raise ValueError(
            f"cycles must be a positive whole number to close the loop, got {cycles!r}"
        )


def bake(obj, data_path: str, fn, frames: int, index: int = -1) -> None:
    """
    Evaluate `fn(frame)` on every frame and keyframe the result.

    Baking rather than driving is deliberate: a driver re-evaluates at render
    time and can disagree with itself across a frame-range split render, and
    Blender's own cyclic F-modifier still has to be told where the cycle ends.
    A baked curve is the same numbers on every machine and every render node.
    """
    for frame in range(1, frames + 1):
        value = fn(frame)
        if index >= 0:
            getattr_path(obj, data_path)[index] = value
        else:
            set_path(obj, data_path, value)
        obj.keyframe_insert(data_path=data_path, index=index, frame=frame)

    for fcurve in fcurves_of(obj):
        for point in fcurve.keyframe_points:
            point.interpolation = "LINEAR"


def bake_socket(socket, fn, frames: int) -> None:
    """
    Bake a shader socket's `default_value` across the loop.

    Same idea as `bake`, but node sockets are keyframed on themselves rather
    than through a data path on an object. Interpolation is left alone: the
    only thing baked this way is a linear phase ramp, and forcing LINEAR here
    would need the node tree's action, which is a different lookup again.
    """
    for frame in range(1, frames + 1):
        socket.default_value = fn(frame)
        socket.keyframe_insert(data_path="default_value", frame=frame)


def fcurves_of(obj) -> list:
    """
    Every F-curve on an object, across Blender's two action layouts.

    4.4 introduced slotted actions and 5.0 dropped `action.fcurves` entirely,
    so the curves now live under layers -> strips -> channelbag(slot). The old
    path is still tried first because a legacy action opened in a new Blender
    keeps it.
    """
    anim = getattr(obj, "animation_data", None)
    action = getattr(anim, "action", None)
    if action is None:
        return []

    legacy = getattr(action, "fcurves", None)
    if legacy is not None:
        return list(legacy)

    slot = getattr(anim, "action_slot", None)
    curves = []
    for layer in action.layers:
        for strip in layer.strips:
            bag = strip.channelbag(slot) if slot is not None else None
            if bag is not None:
                curves.extend(bag.fcurves)
    return curves


def getattr_path(obj, data_path: str):
    """Resolve a dotted data path to the collection that holds it."""
    parts = data_path.split(".")
    target = obj
    for part in parts[:-1]:
        target = getattr(target, part)
    return getattr(target, parts[-1])


def set_path(obj, data_path: str, value) -> None:
    parts = data_path.split(".")
    target = obj
    for part in parts[:-1]:
        target = getattr(target, part)
    setattr(target, parts[-1], value)
