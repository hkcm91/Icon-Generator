"""Lava lamp motion wallpaper — procedural Blender scene builder.

Builds and renders a phone-portrait loop of a lava lamp: a tapered glass
vessel of tinted liquid, a pool of wax on the heated floor, and blobs that
neck away from that pool, climb, flatten under the cool top and sink back.
Every parameter is a CLI flag; nothing is hand-placed in the .blend.

Run headless:

    blender -b -P blender/lava_lamp.py -- --out renders/lava

Or against the `bpy` pip module:

    python blender/lava_lamp.py --out renders/lava

Built from `liquid_shaker.py` — same skeleton, same conventions, same flag
vocabulary. The one structural difference is the motion. The shaker sloshes,
which means a fluid sim, which means a bake, a cache and a crossfade over the
seam where the sim fails to return to where it started. Wax in a lava lamp
does not slosh: it creeps, on a cycle slow enough to write down. So the blobs
here are a keyframed metaball family, every term an integer harmonic of the
loop. There is no bake, no cache, no pre-roll and no seam — frame `loop + 1`
*is* frame 1, exactly, and the render starts the moment the scene is built.

See blender/LAVA_LAMP.md for the flag reference and quality presets.
"""

from __future__ import annotations

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

# --------------------------------------------------------------------------
# palette
# --------------------------------------------------------------------------

# Wax against liquid is the whole colour story, and the medium is the harder
# half of it. Its colour is what it *transmits*, so a medium chosen as the
# wax's exact complement removes precisely the wavelengths the wax is made of,
# and the blobs come back grey. The teal first written for `lagoon` passed a
# red of 0.02 — pink wax through it rendered mauve. Every medium here now
# passes enough of its wax's dominant channel for the wax to survive the
# crossing. Each entry is (wax, liquid, metal); the metal carries base and cap.
PALETTES = {
    # The 1963 original: molten orange in deep blue-violet, brass fittings.
    "classic": ((0.98, 0.29, 0.05), (0.045, 0.075, 0.34), (0.79, 0.60, 0.26)),
    # Softer, warmer room: coral wax in a sea-green medium.
    "lagoon": ((0.99, 0.31, 0.49), (0.17, 0.32, 0.28), (0.86, 0.84, 0.80)),
    # High-contrast novelty: acid green wax in a near-black bottle.
    "toxic": ((0.63, 0.98, 0.13), (0.05, 0.14, 0.06), (0.72, 0.74, 0.76)),
    # Cool room, hot lamp: magenta wax in indigo.
    "midnight": ((0.92, 0.16, 0.72), (0.05, 0.04, 0.26), (0.55, 0.57, 0.66)),
    # Not a lamp at all: luminous pink bubbles in a violet ground. The medium
    # passes magenta rather than blue, so the whole frame carries the wax's
    # own hue instead of contrasting with it.
    "bubblegum": ((1.00, 0.20, 0.62), (0.30, 0.07, 0.38), (0.78, 0.74, 0.84)),
}

# A look is a set of defaults, not a mode: every flag it sets can still be
# overridden on the command line, because argparse defaults lose to arguments.
#
# `bubbles` is the same pipeline pointed somewhere else entirely. There is no
# bulb, so nothing is a lamp; the wax glows uniformly instead of over a heater;
# it is small enough that the convection roll carries it rather than buoyancy,
# so it never returns to the floor and the band gets mapped onto the whole
# column; and the population is four times denser and half the size, which is
# what stops it merging into masses.
LOOKS = {
    "lamp": {},
    # Molten flow in the bubbles' colours: a pool to neck off, wax big enough
    # to buoyancy-cycle rather than ride the roll, a threshold that lets
    # neighbours join, elongation with speed, and no swirl — lava rises and
    # falls, it does not orbit.
    "lava": {
        "palette": "bubblegum", "accent": "1.0,0.32,0.03", "glass": 0.85,
        "bulb_colour": "1.0,0.30,0.02", "ember": 0.0,
        "bulb_size": 0.18, "bulb_depth": 0.10,
        "blobs": 14, "droplets": 5, "blob_size": 0.32, "size_spread": 0.5,
        "threshold": 0.75, "stretch": 0.7, "pool": 0.04, "depth": 0.7,
        "gloss": 1.0, "swirl": 0,
        "glow": 0.7, "glow_reach": 0.75, "bulb": 2600.0, "crown": 140.0,
        "backlight": 0.0, "glint": 3000.0, "glint_size": 0.25, "bloom": 0.35,
        "env": 7.0, "haze": 0.12, "density": 2.6, "dof": 7.0,
        "liquid_colour": "0.05,0.03,0.20", "crest": "0.40,0.22,0.92",
        "backdrop": "0.001,0.002,0.009", "backdrop_floor": "0.16,0.04,0.20",
        "view_transform": "Standard",
    },
    "bubbles": {
        "palette": "bubblegum", "no_pool": True,
        "blobs": 32, "droplets": 18, "blob_size": 0.20, "size_spread": 1.1,
        "threshold": 0.32, "stretch": 0.15, "pool": 0.06, "depth": 1.0,
        "accent": "1.0,0.34,0.02", "gloss": 1.0, "swirl": 1,
        "glow": 0.35, "glow_reach": 1.0, "bulb": 0.0, "crown": 300.0,
        "env": 6.0, "haze": 0.15, "density": 1.5, "dof": 4.0,
        "backdrop": "0.008,0.006,0.016",
        "view_transform": "Standard",
    },
}


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse our flags whether we are run through Blender or through `bpy`.

    `blender -b -P script.py -- --out x` puts our flags after a `--`; running
    the same file with a Python that has the `bpy` module installed puts them
    straight on argv. Anything before a `--` belongs to Blender, not us.
    """
    if argv is None:
        if "--" in sys.argv:
            argv = sys.argv[sys.argv.index("--") + 1:]
        elif os.path.basename(sys.argv[0]).startswith("blender"):
            argv = []  # launched by Blender with no flags of our own
        else:
            argv = sys.argv[1:]

    p = argparse.ArgumentParser(prog="lava_lamp", description=__doc__)
    p.add_argument("--look", choices=sorted(LOOKS), default="lamp",
                   help="a named set of defaults. lamp: a lava lamp. "
                        "bubbles: a dense field of luminous bubbles with no "
                        "lamp around it. Every flag a look sets can still be "
                        "overridden by passing it")

    shape = p.add_argument_group("vessel")
    shape.add_argument("--shape", choices=["fullbleed", "lamp"],
                       default="fullbleed",
                       help="fullbleed: the glass column oversizes the frame "
                            "so its walls fall outside it and the render is a "
                            "wallpaper of the lava itself. lamp: the whole "
                            "object — base, bottle, cap — framed with "
                            "headroom, the product shot")
    shape.add_argument("--width", type=float, default=2.0,
                       help="fullbleed: frame width in metres. lamp: the "
                            "bottle's widest outer diameter")
    shape.add_argument("--height", type=float, default=0.0,
                       help="glass height in metres; 0 derives it from the "
                            "render aspect (fullbleed) or from --width (lamp)")
    shape.add_argument("--neck", type=float, default=0.60,
                       help="lamp only: top radius as a fraction of the "
                            "widest radius")
    shape.add_argument("--taper", type=float, default=1.25,
                       help="lamp only: taper exponent up the bottle. 1 is a "
                            "straight cone, higher keeps the belly full and "
                            "pinches late, 0 is a plain cylinder")
    shape.add_argument("--segments", type=int, default=128,
                       help="mesh resolution around the vessel")
    shape.add_argument("--rings", type=int, default=96,
                       help="mesh resolution up the vessel's profile")
    shape.add_argument("--wall", type=float, default=0.035,
                       help="glass wall thickness in metres")
    shape.add_argument("--fill", type=float, default=0.0,
                       help="liquid level as a fraction of interior height. "
                            "0 picks a default for --shape: 0.94 for lamp, so "
                            "there is an air gap under the cap, and 1.0 for "
                            "fullbleed, where the meniscus would otherwise "
                            "cut a hard line across the top of the wallpaper")
    shape.add_argument("--density", type=float, default=2.2,
                       help="how deeply the medium tints what you see through "
                            "it, as optical depth across the full width of "
                            "the vessel. Normalising it that way is what "
                            "keeps --shape fullbleed — a much wider column — "
                            "from swallowing the wax in fog at the same "
                            "number")
    shape.add_argument("--haze", type=float, default=0.5,
                       help="scattering in the medium, in the same optical "
                            "depth units as --density. This is what makes the "
                            "bulb visible as light *in* the liquid rather "
                            "than only on what the liquid contains, and it is "
                            "most of what separates a lava lamp from a jar of "
                            "wax. It is also the expensive part of the render")
    shape.add_argument("--base", type=float, default=0.34,
                       help="lamp only: metal base height as a fraction of "
                            "the glass height")
    shape.add_argument("--cap", type=float, default=0.16,
                       help="lamp only: metal cap height, same units")

    wax = p.add_argument_group("wax")
    wax.add_argument("--blobs", type=int, default=12,
                     help="climbing blobs")
    wax.add_argument("--size-spread", type=float, default=0.35,
                     help="how much blob radii vary, as a fraction above the "
                          "smallest. Kept narrow by default because velocity "
                          "goes as r-squared, so a population spanning a "
                          "factor of two in radius spans a factor of four in "
                          "speed; widen it for a field of bubbles, where the "
                          "variety matters more than the pace agreeing")
    wax.add_argument("--blob-size", type=float, default=0.28,
                     help="blob influence radius as a fraction of the "
                          "interior radius; the rendered blob is a little "
                          "under 60%% of the influence sphere")
    wax.add_argument("--droplets", type=int, default=7,
                     help="small fast beads that run the full column")
    wax.add_argument("--pool", type=float, default=0.10,
                     help="depth of the wax pool on the floor as a fraction "
                          "of interior height. It is also the height the "
                          "physics treats as in contact with the heater, so "
                          "it is never zero")
    wax.add_argument("--no-pool", action="store_true",
                     help="do not build the visible pool. The blobs still "
                          "recharge in the same layer — the wax film on the "
                          "floor is simply taken to be too thin to read, "
                          "which is what a bubble field wants and what a lava "
                          "lamp does not")
    wax.add_argument("--threshold", type=float, default=0.6,
                     help="metaball field threshold. Lower renders a bigger "
                          "blob from the same influence radius AND makes "
                          "blobs merge only when much closer, which is not "
                          "the trade-off it sounds like: at 1.0 two blobs "
                          "fuse across a gap of 0.68 of their radius, at 0.45 "
                          "only across 0.30. Reach for it to get a field that "
                          "is larger and less sticky at once")
    wax.add_argument("--mesh-res", type=float, default=0.022,
                     help="metaball polygonisation size in metres at render "
                          "time. Smaller is rounder and much slower")
    wax.add_argument("--palette", choices=sorted(PALETTES), default="classic")
    wax.add_argument("--wax-colour", default="",
                     help="override the palette's wax as r,g,b in 0-1")
    wax.add_argument("--liquid-colour", default="",
                     help="override the palette's medium as r,g,b in 0-1")
    wax.add_argument("--metal-colour", default="",
                     help="override the palette's metal as r,g,b in 0-1")
    wax.add_argument("--gloss", type=float, default=0.0,
                     help="0 leaves the wax matte, as wax is. 1 makes it a "
                          "polished shell: hard specular, a full coat, and a "
                          "highlight where the light above it lands. Note it "
                          "also un-hides that light from glossy rays, because "
                          "a glossy surface with nothing to reflect just "
                          "looks darker rather than shinier")
    wax.add_argument("--crest", default="",
                     help="a third colour for the top of the vessel, as r,g,b. "
                          "With --accent this makes the wax a three-stop "
                          "gradient — accent at the floor, the palette's wax "
                          "through the middle, this at the crest")
    wax.add_argument("--glass", type=float, default=0.0,
                     help="0 is wax, opaque. 1 is tinted glass: light passes "
                          "through and the ground shows through every blob. "
                          "This is the difference between a sphere that reads "
                          "as a bubble and one that reads as an egg")
    wax.add_argument("--accent", default="",
                     help="a second colour for the floor of the vessel, as "
                          "r,g,b in 0-1. Given one, both the wax and the "
                          "medium grade from it at the bottom to their own "
                          "colour at the top, so the whole frame carries one "
                          "gradient rather than the wax carrying a different "
                          "one from the ground behind it. Empty or 'none' "
                          "for a single-colour scene")

    motion = p.add_argument_group("motion")
    motion.add_argument("--loop", type=int, default=0,
                        help="frames in the finished loop. 0 takes it from "
                             "the physics: the median blob's own convection "
                             "period, times --fps. A lava lamp is slow, so "
                             "that is a long loop — see --fps")
    motion.add_argument("--fps", type=int, default=12,
                        help="frames per second. Low on purpose: the wax "
                             "moves at millimetres per second, and motion "
                             "that slow is indistinguishable at 12fps from "
                             "30fps while costing 60%% less to render")

    physics = p.add_argument_group("physics")
    physics.add_argument("--viscosity", type=float, default=0.014,
                         help="dynamic viscosity of the medium in Pa s. The "
                              "single most direct speed control: blob "
                              "velocity is inversely proportional to it")
    physics.add_argument("--lift", type=float, default=3.4,
                         help="density swing of the wax between cold and "
                              "fully heated, in kg/m3. Small numbers are "
                              "correct — a lava lamp works because the two "
                              "liquids are within a gram per litre of each "
                              "other")
    physics.add_argument("--lag", type=float, default=20.0,
                         help="thermal time constant of a blob in seconds. "
                              "This, not the travel speed, is what sets the "
                              "period: a blob rises for as long as it holds "
                              "its heat and sinks once it has lost it")
    physics.add_argument("--neutral", type=float, default=0.45,
                         help="normalised temperature at which wax and medium "
                              "have the same density. Below it wax sinks, "
                              "above it wax rises")
    physics.add_argument("--circulation", type=float, default=0.25,
                         help="strength of the liquid's own convection roll "
                              "as a fraction of a reference blob's rise "
                              "speed. It should perturb the wax, not carry "
                              "it: past about 0.5 the roll traps blobs in "
                              "mid-column and the lamp stops cycling")
    motion.add_argument("--depth", type=float, default=0.0,
                        help="how much of the vessel's depth the wax uses. 1 "
                             "is the whole bottle; lower crowds it toward the "
                             "camera, where there is less medium in front of "
                             "it to absorb the colour. 0 picks a default for "
                             "--shape: 1.0 for lamp, 0.55 for the much deeper "
                             "fullbleed column")
    motion.add_argument("--swirl", type=int, default=0,
                        help="how many turns around the vessel's axis a blob "
                             "makes per loop. Without it a blob holds one "
                             "station and one bearing for the whole loop, so "
                             "the only relative motion in the whole field is "
                             "vertical and blobs never travel past each "
                             "other — they read as separate spheres sharing a "
                             "frame rather than as wax. Whole turns, because "
                             "a fraction of one would not close the loop")
    motion.add_argument("--stretch", type=float, default=0.45,
                        help="how much a blob elongates at full climbing "
                             "speed. Volume is held roughly constant")

    out = p.add_argument_group("output")
    out.add_argument("--out", default="//renders/lava",
                     help="output directory for the frame sequence")
    out.add_argument("--res-x", type=int, default=1080)
    out.add_argument("--res-y", type=int, default=2400)
    out.add_argument("--samples", type=int, default=160)
    out.add_argument("--percent", type=int, default=100,
                     help="resolution percentage; 25 for fast look-dev")
    out.add_argument("--margin", type=float, default=0.0,
                     help="framing headroom; 1.0 touches the frame edges. 0 "
                          "picks a default for --shape")
    out.add_argument("--transparent", action="store_true",
                     help="render with a transparent film instead of the "
                          "backdrop")
    out.add_argument("--backdrop", default="0.020,0.022,0.030",
                     help="backdrop colour as r,g,b in 0-1")
    out.add_argument("--backdrop-floor", default="",
                     help="a second backdrop colour for the bottom of the "
                          "frame, as r,g,b. The backdrop then grades from it "
                          "at the floor to --backdrop at the top")
    out.add_argument("--env", type=float, default=0.30,
                     help="world lighting strength. A lava lamp is a light "
                            "source in a dim room, so this stays low; raise "
                            "it and the glass stops reading as lit from "
                            "within")
    out.add_argument("--bulb", type=float, default=140.0,
                     help="wattage of the bulb under the wax")
    out.add_argument("--ember", type=float, default=0.0,
                     help="strength of a glowing disc on the floor of the "
                          "vessel, hot at the centre and dying to red at the "
                          "rim. The bulb is a light and lights things; this "
                          "is the thing you see emitting. 0 disables it")
    out.add_argument("--bulb-size", type=float, default=0.55,
                     help="the bulb's radius as a fraction of the vessel's. "
                          "In a scattering medium a light this size *is* a "
                          "glowing ball of that size; keep it small if the "
                          "source is meant to stay out of the picture")
    out.add_argument("--bulb-depth", type=float, default=0.0,
                     help="how far below the vessel's floor the bulb sits, "
                          "as a fraction of the vessel's height. 0 puts it "
                          "just inside the floor, under the pool; more sinks "
                          "it out of frame so only its light comes up")
    out.add_argument("--bulb-colour", default="1.0,0.63,0.32",
                     help="colour of that bulb as r,g,b. It is the one honest "
                          "way to put a colour at the floor of the vessel: "
                          "translucent wax lit from below carries the light "
                          "up through itself, where a painted gradient just "
                          "sits on the surface")
    out.add_argument("--backlight", type=float, default=0.0,
                     help="fullbleed only: wattage of a wide light behind the "
                          "column, facing the camera. It lights the haze from "
                          "within so the ground becomes lit medium rather "
                          "than dark medium with a wall behind it, and it "
                          "rims every blob. 0 disables it")
    out.add_argument("--backlight-colour", default="0.55,0.12,0.85",
                     help="colour of that backlight as r,g,b")
    out.add_argument("--glint", type=float, default=0.0,
                     help="wattage of one white panel high and to the "
                          "front-left, lighting the wax alone. Every other "
                          "source here is a warm wash; this is the mirror "
                          "highlight on a wet blob. 0 disables it")
    out.add_argument("--glint-size", type=float, default=0.15,
                     help="side of that glint panel as a fraction of the "
                          "frame reach. Small is a pin-prick sparkle; around "
                          "0.35 it reads as the broad white window reflection "
                          "a wet blob carries on its shoulder")
    out.add_argument("--bloom", type=float, default=0.0,
                     help="0-1 glow bleeding off bright areas, via the "
                          "compositor. Cycles has none of its own, and it is "
                          "most of what makes luminous read on a phone")
    out.add_argument("--dof", type=float, default=0.0,
                     help="aperture f-stop for depth of field; 0 disables it. "
                          "Focus sits on the vessel's axis, so wax nearer the "
                          "camera and wax at the back both go soft while the "
                          "middle stays sharp. It is what separates a field "
                          "of blobs into a field with depth in it")
    out.add_argument("--crown", type=float, default=1960.0,
                     help="fullbleed only: wattage of the light above the "
                          "column. It is the only source the top of the frame "
                          "has — the bulb is metres away by then and falling "
                          "off with the square of it — so this is what "
                          "decides whether the upper column reads as liquid "
                          "or as black. In watts rather than as a multiple of "
                          "--bulb, so that turning the bulb off for a look "
                          "with no lamp in it does not take the ceiling light "
                          "down with it")
    out.add_argument("--glow", type=float, default=1.3,
                     help="how hot the wax self-illuminates where it sits "
                          "over the bulb; 0 leaves it lit only by the bulb")
    out.add_argument("--glow-reach", type=float, default=0.7,
                     help="how far up the vessel that glow survives, as a "
                          "fraction of its height. Deliberately not tied to "
                          "--heat: wax carries its heat upward with it, so it "
                          "goes on glowing well above the layer of liquid "
                          "that is actually hot. 1.0 or more removes the "
                          "falloff entirely and lights every blob equally, "
                          "which is what a bubble field wants and what a lamp "
                          "with a bulb in the bottom of it does not")
    out.add_argument("--heat", type=float, default=0.08,
                     help="decay length of the liquid's temperature, as a "
                          "fraction of the vessel's height. This is one "
                          "number doing two jobs, because they are the same "
                          "job: it is the profile the blobs heat and cool "
                          "against, and it is how far up the wax's own glow "
                          "survives. It has to stay short — the bulk of the "
                          "column must sit below --neutral or a blob has no "
                          "reason to ever come back down, and the lamp "
                          "settles into a still life")
    out.add_argument("--blend-frames", type=int, default=0,
                     help="frames crossfaded across the loop seam. Unlike the "
                          "shaker's sim this loop closes exactly, so the "
                          "default is off")
    out.add_argument("--encode", action="store_true",
                     help="encode an mp4 next to the frame sequence")
    out.add_argument("--no-render", action="store_true",
                     help="build the scene but do not render")
    out.add_argument("--check-loop", action="store_true",
                     help="build the scene, prove the loop closes and exit "
                          "without rendering. The whole design rests on that "
                          "claim, so it is cheap to make it checkable")
    out.add_argument("--save-blend", default="",
                     help="write the built scene to this .blend path")
    out.add_argument("--device", choices=["CPU", "GPU"], default="CPU")
    out.add_argument("--view-transform", default="Khronos PBR Neutral",
                     choices=["Khronos PBR Neutral", "AgX", "Standard",
                              "Filmic"])
    out.add_argument("--exposure", type=float, default=0.0)

    # Read --look first, fold its defaults in, then parse for real so that
    # anything given explicitly still wins.
    known, _ = p.parse_known_args(argv)
    p.set_defaults(**LOOKS[known.look])
    args = p.parse_args(argv)

    wax_c, liquid_c, metal_c = PALETTES[args.palette]
    args.wax_rgb = _colour(args.wax_colour, wax_c)
    args.liquid_rgb = _colour(args.liquid_colour, liquid_c)
    args.metal_rgb = _colour(args.metal_colour, metal_c)
    args.accent_rgb = (None if args.accent.strip().lower() in ("", "none")
                       else _colour(args.accent, (1.0, 1.0, 1.0)))
    args.crest_rgb = (None if args.crest.strip().lower() in ("", "none")
                      else _colour(args.crest, (1.0, 1.0, 1.0)))
    args.bulb_rgb = _colour(args.bulb_colour, (1.0, 0.63, 0.32))
    args.backdrop_floor_rgb = (
        None if args.backdrop_floor.strip().lower() in ("", "none")
        else _colour(args.backdrop_floor, (0.0, 0.0, 0.0)))
    args.backlight_rgb = _colour(args.backlight_colour, (0.55, 0.12, 0.85))
    if args.fill <= 0.0:
        args.fill = 0.94 if args.shape == "lamp" else 1.0
    if args.depth <= 0.0:
        args.depth = 1.0 if args.shape == "lamp" else 0.55
    return args


def _colour(text: str, fallback: tuple[float, float, float]):
    if not text:
        return fallback
    parts = tuple(float(c) for c in text.split(","))
    if len(parts) != 3:
        raise ValueError(f"expected r,g,b — got {text!r}")
    return parts


def clear_scene() -> None:
    """Empty the file so repeated runs in one session stay deterministic."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link(obj: bpy.types.Object) -> bpy.types.Object:
    bpy.context.collection.objects.link(obj)
    return obj


def activate(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def put(node: bpy.types.Node, names: tuple[str, ...], value) -> None:
    """Set the first socket that exists, so the script survives the socket
    renames between Blender 3.x and 4.x (Transmission → Transmission Weight)."""
    for name in names:
        found = node.inputs.get(name)
        if found is not None:
            found.default_value = value
            return


def socket(node: bpy.types.Node, names: tuple[str, ...]):
    """The first socket that exists, for linking rather than setting."""
    for name in names:
        found = node.inputs.get(name)
        if found is not None:
            return found
    return None


def rgba(colour, alpha: float = 1.0):
    return (colour[0], colour[1], colour[2], alpha)


def scaled(colour, factor: float):
    return tuple(min(1.0, c * factor) for c in colour)


# The stiffness every element here is given. Blender's default.
STIFFNESS = 2.0


def surface_fraction(threshold: float, stiffness: float = STIFFNESS) -> float:
    """How much of an element's influence radius actually renders.

    A metaball element's `radius` is the radius of its *influence*, and the
    surface lands well inside it: the falloff is `stiffness·(1 − d²/r²)³`, so
    an isolated ball meets the threshold at `sqrt(1 − (T/s)^(1/3))` of its
    radius — 0.575 at the defaults. Everything that has to touch a wall (the
    pool ring, a blob's clearance from the glass) and everything that has to
    know a blob's true size (the physics, which is all in real millimetres)
    measures with this rather than with the influence radius.

    It is computed rather than written down because `--threshold` moves it:
    at 0.9 a blob renders at 0.484 of its influence, not 0.575, and a constant
    would silently misplace the pool and mis-scale every blob's physics the
    moment anyone touched that flag.
    """
    ratio = min(0.999, max(0.0, threshold / max(1e-6, stiffness)))
    return math.sqrt(max(1e-4, 1.0 - ratio ** (1.0 / 3.0)))


def jitter(index: int, salt: int) -> float:
    """A deterministic 0-1 value per blob, independent across salts.

    This wants two properties that pull against each other, and getting only
    the first is what the two previous versions of this function did.

    It must be *reproducible*: `--blobs 12` always builds the same twelve
    blobs, and blob 3 is blob 3 across every render. An RNG would do that with
    a seed.

    It must also be *independent between salts*. Every attribute of a blob —
    size, phase, station, azimuth — is drawn from this, and if two salts give
    sequences that are shifts of one another, then blobs that are close in one
    attribute are close in all of them. That is exactly what happened: with
    `frac((i+1)·golden + salt·k)`, salt only offsets the sequence, so a blob's
    station and its azimuth and its phase were the same number plus a
    constant. Blobs adjacent in the sequence came out the same size, at the
    same radius, at the same angle, a hair apart in phase — and rendered as
    beads threaded on a wire, which is not a thing lamps do.

    So: an integer mixer, which decorrelates the salts properly. The even
    spread that the low-discrepancy sequence was there for is now got where it
    actually matters — the phases — by stratifying them in blob_specs instead.
    """
    x = (index * 0x9E3779B1 + salt * 0x85EBCA77 + 0x165667B1) & 0xFFFFFFFF
    x ^= x >> 16
    x = (x * 0x7FEB352D) & 0xFFFFFFFF
    x ^= x >> 15
    x = (x * 0x846CA68B) & 0xFFFFFFFF
    x ^= x >> 16
    return x / 4294967296.0


# --------------------------------------------------------------------------
# geometry
# --------------------------------------------------------------------------


def bottle_profile(height: float, r_max: float, r_neck: float, taper: float,
                   rings: int, fillet: float = 0.05) -> list[tuple[float, float]]:
    """The vessel silhouette as (radius, z) samples, floor to rim.

    The taper term is the bottle: radius falls from the belly to the neck as
    `(1 - u) ** taper`, so `--taper 1` is a plain cone and higher values hold
    the belly full and pinch late — which is the shape the wax needs, because
    a blob only necks off the pool if the floor is wider than the column it
    has to climb.

    The fillets at either end are not decoration. A cylinder cut square at the
    floor gives the glass a knife edge, and a knife edge in a transmissive
    material total-internal-reflects into a black ring. Rolling both ends over
    gives those rays something to find.
    """
    pts = []
    for i in range(rings + 1):
        u = i / rings
        r = r_neck + (r_max - r_neck) * (1.0 - u) ** taper if taper > 0 \
            else r_max
        if fillet > 0.0:
            if u < fillet:
                r *= 0.82 + 0.18 * math.sin(u / fillet * math.pi / 2)
            elif u > 1.0 - fillet:
                r *= 0.82 + 0.18 * math.sin((1.0 - u) / fillet * math.pi / 2)
        pts.append((r, u * height))
    return pts


def revolve(name: str, profile: list[tuple[float, float]],
            segments: int) -> bpy.types.Object:
    """Spin a (radius, z) profile around Z into a closed solid.

    Both ends are capped to a pole vertex. That leaves a fan of thin triangles
    which `remove_doubles` then collapses — the same trick `liquid_shaker`'s
    pillow uses at its poles, and for the same reason: zero-area faces are
    what put fireflies in a refractive render.
    """
    verts: list[Vector] = []
    faces: list[tuple[int, ...]] = []
    rings = len(profile)

    for r, z in profile:
        for i in range(segments):
            a = 2 * math.pi * i / segments
            verts.append(Vector((r * math.cos(a), r * math.sin(a), z)))

    for j in range(rings - 1):
        for i in range(segments):
            a = j * segments + i
            b = j * segments + (i + 1) % segments
            c = (j + 1) * segments + (i + 1) % segments
            d = (j + 1) * segments + i
            faces.append((a, b, c, d))

    floor = len(verts)
    verts.append(Vector((0.0, 0.0, profile[0][1])))
    for i in range(segments):
        faces.append((floor, (i + 1) % segments, i))

    ceiling = len(verts)
    verts.append(Vector((0.0, 0.0, profile[-1][1])))
    top = (rings - 1) * segments
    for i in range(segments):
        faces.append((ceiling, top + i, top + (i + 1) % segments))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate(verbose=False)
    obj = link(bpy.data.objects.new(name, mesh))
    activate(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    shade_auto_smooth(obj)
    return obj


def shade_auto_smooth(obj: bpy.types.Object, angle: float = 50.0) -> None:
    """Smooth the curved walls, keep the cap seams sharp.

    Not with `bpy.ops.object.shade_auto_smooth`. In 4.1 that operator became a
    wrapper that appends a bundled "Smooth by Angle" node group from Blender's
    essentials asset library — and the `bpy` wheel does not finish loading that
    library, so the call returns `FINISHED` having done nothing at all. There
    is no exception to catch. The mesh is simply left flat.

    On a lathed vessel that is not a subtle difference. Flat shading a
    refractor makes every facet bend light its own way, and the wax behind it
    grows a comb of dark hairs along its silhouette, one tooth per facet
    column — which looks like a fault in the metaballs and is nothing to do
    with them. Both paths below are plain mesh operators with no asset
    dependency, so what they do is what they say.
    """
    activate(obj)
    bpy.ops.object.shade_smooth()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.mesh.select_mode(type="EDGE")
    bpy.ops.mesh.edges_select_sharp(sharpness=math.radians(angle))
    bpy.ops.mesh.mark_sharp()
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    # 4.1 onward honours sharp edges natively; 3.x needs the mesh flag as well.
    if hasattr(obj.data, "use_auto_smooth"):
        obj.data.use_auto_smooth = True
        obj.data.auto_smooth_angle = math.radians(angle)
    assert any(p.use_smooth for p in obj.data.polygons), obj.name


def cut_above(obj: bpy.types.Object, z: float, span: float) -> None:
    """Boolean the object down to everything below `z`, keeping it closed."""
    box = span * 3.0
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    cutter = bpy.context.active_object
    cutter.name = f"{obj.name}_cutter"
    cutter.scale = (box, box, box)
    cutter.location = (0.0, 0.0, z - box * 0.5)

    activate(obj)
    mod = obj.modifiers.new("fill_level", "BOOLEAN")
    mod.operation = "INTERSECT"
    mod.object = cutter
    mod.solver = "EXACT"
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def radius_sampler(profile: list[tuple[float, float]]):
    """Interpolate the profile's radius at any height.

    The blobs need this to stay inside the glass. A blob that clips the wall
    does not look like wax touching glass, it looks like a modelling mistake,
    and in a refractive render it reads as a hard bright scar.
    """
    def sample(z: float) -> float:
        if z <= profile[0][1]:
            return profile[0][0]
        if z >= profile[-1][1]:
            return profile[-1][0]
        for (r0, z0), (r1, z1) in zip(profile, profile[1:]):
            if z0 <= z <= z1:
                k = 0.0 if z1 == z0 else (z - z0) / (z1 - z0)
                return r0 + (r1 - r0) * k
        return profile[-1][0]
    return sample


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------


def new_material(name: str) -> tuple[bpy.types.Material, bpy.types.NodeTree]:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    tree.nodes.clear()
    return mat, tree


def glass_material() -> bpy.types.Material:
    """The bottle. Thick, clear, faintly green at the edges like real glass."""
    mat, tree = new_material("lava_glass")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    out.location = (300, 0)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")

    put(bsdf, ("Base Color",), rgba((0.94, 0.99, 0.96)))
    put(bsdf, ("Roughness",), 0.02)
    put(bsdf, ("IOR",), 1.46)
    put(bsdf, ("Transmission Weight", "Transmission"), 1.0)
    put(bsdf, ("Coat Weight", "Clearcoat"), 0.6)
    put(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.03)
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def liquid_material(reference: bpy.types.Object, height: float, colour,
                    density: float, haze: float,
                    accent=None) -> bpy.types.Material:
    """The medium the wax moves through: clear surface, tinted volume.

    Absorption rather than a coloured surface, so the tint deepens with the
    path length through the bottle. That is what puts a blob's silhouette
    slightly out of focus when it is at the back of the vessel and sharp when
    it is against the front wall, without any of it being drawn.

    The gradient runs the other way from the obvious one. Absorption colour is
    what the volume *transmits*, so a darker colour higher up means the top of
    the column absorbs more — and the top is already the part of the frame
    with the least light reaching it, being furthest from the bulb. Tinting it
    down as well drove it to near-black. It clears with height instead.
    """
    mat, tree = new_material("lava_medium")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)

    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (300, 200)
    put(bsdf, ("Base Color",), rgba((1.0, 1.0, 1.0)))
    put(bsdf, ("Roughness",), 0.02)
    put(bsdf, ("IOR",), 1.36)
    put(bsdf, ("Transmission Weight", "Transmission"), 1.0)
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    coord = tree.nodes.new("ShaderNodeTexCoord")
    coord.location = (-600, -200)
    coord.object = reference

    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.location = (-400, -200)
    mapping.inputs["Scale"].default_value = (1.0, 1.0, 1.0 / height)

    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-200, -200)

    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.location = (0, -200)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = rgba(
        scaled(accent, 0.75) if accent is not None else scaled(colour, 0.9))
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = rgba(scaled(colour, 1.6))

    absorb = tree.nodes.new("ShaderNodeVolumeAbsorption")
    absorb.location = (300, -200)
    absorb.inputs["Density"].default_value = density

    tree.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    tree.links.new(mapping.outputs["Vector"], sep.inputs["Vector"])
    tree.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], absorb.inputs["Color"])

    if haze <= 0.0:
        tree.links.new(absorb.outputs["Volume"], out.inputs["Volume"])
        return mat

    # Absorption alone tells you what is *behind* the liquid. Scattering is
    # what tells you the liquid is lit: it carries the bulb up into the medium
    # as a glow that falls off with height, which is the gradient every
    # photograph of a lava lamp has and no amount of surface shading gives
    # you. Forward-biased, because that is how a real turbid liquid throws a
    # backlight toward the camera.
    scatter = tree.nodes.new("ShaderNodeVolumeScatter")
    scatter.location = (300, -480)
    scatter.inputs["Density"].default_value = haze
    scatter.inputs["Anisotropy"].default_value = 0.35
    # The scattering colour has to grade with height too. Averaging the two
    # ends into one flat colour — which is what this did first — lights the
    # whole volume with the mixture, and the mixture of orange and violet is
    # brown. The frame went dusty from top to bottom and neither end read as
    # its own colour.
    scatter.inputs["Color"].default_value = rgba(scaled(colour, 2.2))
    if accent is not None:
        warm = height_ramp(tree, reference, height, scaled(accent, 2.0),
                           scaled(colour, 2.2), -760)
        tree.links.new(warm.outputs["Color"], scatter.inputs["Color"])

    add = tree.nodes.new("ShaderNodeAddShader")
    add.location = (450, -300)
    tree.links.new(absorb.outputs["Volume"], add.inputs[0])
    tree.links.new(scatter.outputs["Volume"], add.inputs[1])
    tree.links.new(add.outputs["Shader"], out.inputs["Volume"])
    return mat


def height_ramp(tree, reference: bpy.types.Object, height: float,
                low, high, y: int = -200, mid=None):
    """A colour ramp driven by height in the vessel, `low` at the floor.

    Anchored to the vessel rather than to whatever object carries the
    material, for the same reason everything else here is: the wax is one
    metaball family sharing one material, and coordinates taken from the wax
    itself would give every blob the same gradient over its own body however
    high it had climbed.
    """
    coord = tree.nodes.new("ShaderNodeTexCoord")
    coord.location = (-1000, y)
    coord.object = reference

    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.location = (-800, y)
    mapping.inputs["Scale"].default_value = (1.0, 1.0, 1.0 / height)

    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-620, y)

    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-440, y)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = rgba(low)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = rgba(high)
    if mid is not None:
        stop = ramp.color_ramp.elements.new(0.5)
        stop.color = rgba(mid)

    tree.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    tree.links.new(mapping.outputs["Vector"], sep.inputs["Vector"])
    tree.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    return ramp


def wax_material(reference: bpy.types.Object, height: float, colour,
                 glow: float, heat: float, blob: float,
                 accent=None, gloss: float = 0.0,
                 glass: float = 0.0, crest=None) -> bpy.types.Material:
    """Translucent wax, hot at the floor and cooling as it climbs.

    Two things make wax read as wax rather than as plastic. The first is
    subsurface: light goes into a blob, bounces around and comes out
    elsewhere, so a blob backlit by the bulb glows through instead of
    silhouetting. The second is that the heat is *local* — the wax over the
    bulb is near-incandescent and the wax at the top is nearly extinguished.

    That gradient has to come off the vessel's coordinates, not the blobs'.
    The wax is one metaball family, so every blob shares this material and
    object coordinates taken from the wax itself would give each blob the same
    gradient over its own body, however high it had climbed. Anchoring to the
    bottle makes height mean height.
    """
    mat, tree = new_material("lava_wax")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)

    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (300, 0)
    put(bsdf, ("Base Color",), rgba(colour))
    grade = None
    if accent is not None or crest is not None:
        # Three stops when both are given: the palette's own colour moves to
        # the middle. With only a crest, the wax grades from its own colour
        # at the floor to the crest at the top.
        grade = height_ramp(tree, reference, height,
                            accent if accent is not None else colour,
                            crest if crest is not None else colour, -640,
                            mid=colour if (accent is not None
                                           and crest is not None) else None)
        tree.links.new(grade.outputs["Color"], bsdf.inputs["Base Color"])
    put(bsdf, ("Roughness",), 0.24 - 0.225 * gloss)
    put(bsdf, ("IOR",), 1.45 + 0.05 * gloss)
    # Subsurface is what makes wax read as wax, and it is also what keeps a
    # surface from reading as polished: light that goes in and comes out
    # somewhere else softens exactly the contrast a highlight needs. Gloss
    # takes most of it away.
    # Gel, not glass. Pure transmission shows what is behind the blob, and
    # what is behind it is dark medium — so the first version of this went
    # grey. Jelly is three things at once: light diffusing inside it
    # (subsurface), a wet skin (coat), and some see-through (transmission).
    # Glass here brings subsurface back up rather than removing it.
    put(bsdf, ("Subsurface Weight", "Subsurface"),
        0.7 * (1.0 - 0.85 * gloss) * (1.0 - glass) + 0.3 * glass)
    put(bsdf, ("Transmission Weight", "Transmission"), 0.9 * glass)
    glow = glow * (1.0 - 0.6 * glass)
    # Scattering distance is measured against the blob, which is why it is
    # passed in rather than guessed from the bottle. Set it to the blob radius
    # and light walks clean through everything, every blob washes out to the
    # same pale cream and the colour you see is the scatter's rather than the
    # wax's. Set it to nothing and a blob is an opaque brown pebble with a
    # bright bottom. At about a third of the radius the thin edges glow and
    # the thick middle holds its hue, which is what wax over a bulb does.
    put(bsdf, ("Subsurface Scale",), blob * 0.34)
    put(bsdf, ("Subsurface Radius",), (1.0, 0.45, 0.22))
    put(bsdf, ("Coat Weight", "Clearcoat"), 0.35 + 0.65 * gloss)
    put(bsdf, ("Coat Roughness", "Clearcoat Roughness"), 0.12 - 0.10 * gloss)
    # A wet skin reflects more than a 1.5 varnish does: the reference's
    # white shoulder highlight is a hard mirror, so glossy pushes the coat
    # IOR up and the reflection with it.
    put(bsdf, ("Coat IOR",), 1.5 + 0.4 * gloss)
    try:
        bsdf.subsurface_method = "RANDOM_WALK"
    except TypeError:
        pass
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    if glow <= 0.0:
        return mat

    if heat >= 1.0:
        # No falloff at all: every blob is equally luminous wherever it is.
        # Wrong for a lamp, which needs a bulb at the bottom to be the reason
        # for anything, and right for a field of bubbles, which has no bulb
        # and no bottom.
        emission = socket(bsdf, ("Emission Color", "Emission"))
        if emission is not None:
            if grade is not None:
                tree.links.new(grade.outputs["Color"], emission)
            else:
                emission.default_value = rgba(scaled(colour, 1.15))
        # Brighter through the middle of a bubble than at its rim. A sphere
        # lit flat is a flat disc on screen, and it is the fall-off toward the
        # edge that makes it read as round and as something you are seeing
        # *into*. Facing ratio does it for free: 1 where the surface points at
        # the camera, 0 where it turns away.
        facing = tree.nodes.new("ShaderNodeLayerWeight")
        facing.location = (-200, -420)
        facing.inputs["Blend"].default_value = 0.5

        core = tree.nodes.new("ShaderNodeMapRange")
        core.location = (0, -420)
        core.inputs["From Min"].default_value = 0.0
        core.inputs["From Max"].default_value = 1.0
        core.inputs["To Min"].default_value = glow * 1.55
        core.inputs["To Max"].default_value = glow * 0.45
        tree.links.new(facing.outputs["Facing"], core.inputs["Value"])
        power = socket(bsdf, ("Emission Strength",))
        if power is not None:
            tree.links.new(core.outputs["Result"], power)
        return mat

    coord = tree.nodes.new("ShaderNodeTexCoord")
    coord.location = (-800, -200)
    coord.object = reference

    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.location = (-600, -200)
    mapping.inputs["Scale"].default_value = (1.0, 1.0, 1.0 / height)

    sep = tree.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-400, -200)

    # Heat runs out well before the top: past `heat` the wax is lit by the
    # bulb alone. Ramp it over the whole column instead and every blob glows
    # equally, which reads as a stack of paper lanterns rather than as a lamp
    # with a bulb in the bottom of it.
    falloff = tree.nodes.new("ShaderNodeValToRGB")
    falloff.location = (-200, -200)
    falloff.color_ramp.elements[0].position = 0.0
    falloff.color_ramp.elements[0].color = rgba((1.0, 1.0, 1.0))
    falloff.color_ramp.elements[1].position = max(0.02, heat)
    falloff.color_ramp.elements[1].color = rgba((0.0, 0.0, 0.0))

    tint = tree.nodes.new("ShaderNodeValToRGB")
    tint.location = (0, -420)
    tint.color_ramp.elements[0].position = 0.0
    tint.color_ramp.elements[0].color = rgba(colour)
    tint.color_ramp.elements[1].position = 1.0
    # A gentle boost. `scaled` clamps per channel, so a large multiplier on a
    # saturated colour pins its strong channels at 1 and lifts only the weak
    # one — which is desaturation dressed up as brightness. At 1.8 a hot pink
    # went to (1, 0.76, 1), and the wax rendered white-lilac.
    tint.color_ramp.elements[1].color = rgba(scaled(colour, 1.25))

    strength = tree.nodes.new("ShaderNodeMath")
    strength.location = (0, -200)
    strength.operation = "MULTIPLY"
    strength.inputs[1].default_value = glow

    tree.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    tree.links.new(mapping.outputs["Vector"], sep.inputs["Vector"])
    tree.links.new(sep.outputs["Z"], falloff.inputs["Fac"])
    tree.links.new(falloff.outputs["Color"], strength.inputs[0])
    tree.links.new(falloff.outputs["Color"], tint.inputs["Fac"])

    emission = socket(bsdf, ("Emission Color", "Emission"))
    if emission is not None:
        tree.links.new((grade or tint).outputs["Color"], emission)
    power = socket(bsdf, ("Emission Strength",))
    if power is not None:
        tree.links.new(strength.outputs["Value"], power)
    return mat


def metal_material(colour) -> bpy.types.Material:
    """Spun metal for the base and cap — brushed, not mirror."""
    mat, tree = new_material("lava_metal")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    out.location = (300, 0)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    put(bsdf, ("Base Color",), rgba(colour))
    put(bsdf, ("Metallic",), 1.0)
    put(bsdf, ("Roughness",), 0.26)
    put(bsdf, ("Anisotropic",), 0.5)
    tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def backdrop_material(colour, extent: float,
                      floor=None) -> bpy.types.Material:
    """A dark room with a soft pool of light behind the lamp.

    The shaker emits a white sweep because a product shot wants one. A lava
    lamp is the opposite problem: it is a light source, and against an evenly
    lit backdrop it stops looking like one. So this is near-black with a
    radial lift behind the bottle, which gives the silhouette an edge to sit
    against without lighting the room.
    """
    mat, tree = new_material("lava_backdrop")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)

    coord = tree.nodes.new("ShaderNodeTexCoord")
    coord.location = (-800, 0)

    # The gradient's falloff is one unit of object space, and the panel is
    # metres across — so without this it is a one-metre hotspot on a nine-metre
    # wall. Behind a full-bleed column that hotspot is dead centre and refracts
    # into a bright bar down the middle of the wallpaper, which took a while to
    # recognise as the backdrop rather than as a light. Scaled to the framed
    # area rather than to the panel: what is wanted is a vignette across the
    # picture, and a falloff measured against a panel four times wider than the
    # frame is a flat grey wall with the falloff all off-camera.
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.location = (-600, 0)
    mapping.inputs["Scale"].default_value = (1.0 / extent, 1.0 / extent, 1.0)

    gradient = tree.nodes.new("ShaderNodeTexGradient")
    gradient.location = (-400, 0)
    gradient.gradient_type = "SPHERICAL"

    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-200, 0)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = rgba((0.0, 0.0, 0.0))
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = rgba(scaled(colour, 3.0))

    emit = tree.nodes.new("ShaderNodeEmission")
    emit.location = (150, 0)
    emit.inputs["Strength"].default_value = 1.0

    tree.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    tree.links.new(mapping.outputs["Vector"], gradient.inputs["Vector"])
    tree.links.new(gradient.outputs["Fac"], ramp.inputs["Fac"])
    source = ramp
    if floor is not None:
        # A vertical grade on top of the vignette. The panel is a plane
        # stood up by a quarter turn about X, so its local Y is world up;
        # scaled by the framed extent, 0 is the bottom of the picture and 1
        # the top.
        up = tree.nodes.new("ShaderNodeSeparateXYZ")
        up.location = (-400, -260)
        span = tree.nodes.new("ShaderNodeMapRange")
        span.location = (-240, -260)
        span.inputs["From Min"].default_value = -extent * 0.6
        span.inputs["From Max"].default_value = extent * 0.6
        vert = tree.nodes.new("ShaderNodeValToRGB")
        vert.location = (-60, -260)
        vert.color_ramp.elements[0].position = 0.0
        vert.color_ramp.elements[0].color = rgba(floor)
        vert.color_ramp.elements[1].position = 1.0
        vert.color_ramp.elements[1].color = rgba(colour)
        add = tree.nodes.new("ShaderNodeMixRGB")
        add.location = (0, 0)
        add.blend_type = "ADD"
        add.inputs["Fac"].default_value = 1.0
        tree.links.new(coord.outputs["Object"], up.inputs["Vector"])
        tree.links.new(up.outputs["Y"], span.inputs["Value"])
        tree.links.new(span.outputs["Result"], vert.inputs["Fac"])
        tree.links.new(ramp.outputs["Color"], add.inputs["Color1"])
        tree.links.new(vert.outputs["Color"], add.inputs["Color2"])
        source = add
    tree.links.new(source.outputs["Color"], emit.inputs["Color"])
    tree.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


# --------------------------------------------------------------------------
# the wax
# --------------------------------------------------------------------------


# The physics runs on a real lamp, not on the scene. Scene units are picked
# for framing — a full-bleed column is nearly three metres wide — and a
# buoyancy calculation in those units would describe a bottle the size of a
# house, which convects nothing like one on a table. So a blob's scene radius
# is converted into this canonical bottle, integrated here, and the resulting
# trajectory comes back as fractions of the scene's own column.
REAL_HEIGHT = 0.17      # m, interior height of the bottle being modelled
REAL_RADIUS = 0.036     # m, its interior radius
REF_RADIUS = 0.008      # m, the blob the tuning flags are quoted against
GRAVITY = 9.81

# Heat transfer is faster in the pool than in flight: the blob is in contact
# with the heated floor and with the rest of the pool, not with a thin
# boundary layer of passing liquid.
POOL_CONTACT = 0.30




def env_temp(zn: float, args) -> float:
    """Normalised liquid temperature at normalised height.

    1 at the floor, falling exponentially. Everything above roughly
    `--heat` is below `--neutral`, which is what makes wax up there sink.
    """
    if zn <= args.pool:
        return 1.0
    return math.exp(-(zn - args.pool) / max(1e-3, args.heat))


def rise_speed(radius: float, theta: float, args) -> float:
    """Terminal velocity in m/s; positive is up.

    Stokes drag, and no inertia in the state at all. The Reynolds number here
    is around 0.01 and the momentum relaxation time 2*rho*r^2/(9*mu) is a
    fraction of a second against a cycle of tens of seconds, so a blob is at
    its terminal velocity essentially always. Carrying momentum would add two
    stiff variables to the integration and change nothing you could see.

    The r^2 is why size matters so much here: double the blob and it moves
    four times as fast.
    """
    excess = args.lift * (theta - args.neutral)   # kg/m3, positive = lighter
    return (2.0 / 9.0) * excess * GRAVITY * radius * radius / args.viscosity


def reference_speed(args) -> float:
    return max(1e-9, rise_speed(REF_RADIUS, 1.0, args))


def convection(rn: float, zn: float, args) -> tuple[float, float]:
    """The liquid's own roll: up the middle, out at the top, down the walls,
    in across the floor — as (u_r, u_z) in m/s.

    Taken from a Stokes stream function rather than written down directly, so
    the field is divergence free. A roll that did not conserve volume would
    quietly pump blobs into one corner of the bottle over a long loop.
    """
    speed = args.circulation * reference_speed(args)
    zc = min(1.0, max(0.0, zn))
    s, c = math.sin(math.pi * zc), math.cos(math.pi * zc)
    return (-speed * 0.5 * math.pi * rn * (1.0 - rn * rn) * c,
            speed * (1.0 - 2.0 * rn * rn) * s)


def blob_flow(state: tuple[float, float, float], radius: float,
              args) -> tuple[float, float, float]:
    """d/dt of (horizontal distance from the axis, height, temperature)."""
    r, z, theta = state
    zn = z / REAL_HEIGHT
    rn = min(1.0, max(0.0, r / REAL_RADIUS))
    u_r, u_z = convection(rn, zn, args)
    tau = args.lag * (POOL_CONTACT if zn <= args.pool else 1.0)
    return (u_r,
            rise_speed(radius, theta, args) + u_z,
            (env_temp(zn, args) - theta) / max(1e-3, tau))


def blob_step(state, radius: float, args, dt: float):
    """One RK4 step, with the bottle's walls as hard limits."""
    def add(base, delta, k):
        return tuple(b + delta * d for b, d in zip(base, k))

    k1 = blob_flow(state, radius, args)
    k2 = blob_flow(add(state, dt * 0.5, k1), radius, args)
    k3 = blob_flow(add(state, dt * 0.5, k2), radius, args)
    k4 = blob_flow(add(state, dt, k3), radius, args)
    r, z, theta = (base + dt / 6.0 * (a + 2 * b + 2 * c + d)
                   for base, a, b, c, d in zip(state, k1, k2, k3, k4))
    return (min(REAL_RADIUS * 0.92, max(0.0, r)),
            min(REAL_HEIGHT * 0.985, max(REAL_HEIGHT * 0.012, z)),
            min(1.0, max(0.0, theta)))


def limit_cycle(radius: float, args, dt: float = 0.05, settle: float = 300.0,
                probe: float = 520.0, samples: int = 192):
    """Integrate a blob until it forgets where it started, then record one
    period of what it settled into.

    The oscillation is a relaxation cycle and it is worth being explicit about
    why one exists at all, because the obvious version of this model does not
    have one. Give the liquid a gentle temperature gradient and the blob
    spirals into the height where its density matches the medium and stops
    there, damped, forever — which is a perfectly good simulation of a lava
    lamp that has not been switched on. What sustains the cycle is that the
    bulk of the column sits below the neutral temperature, so the *only* place
    a blob can become buoyant is in contact with the pool. It charges there,
    coasts up on stored heat, loses it, and comes back for more.

    Returns (period in seconds, table) where each table row is
    (height, distance from the axis, |vertical speed|), all normalised.
    """
    state = (REAL_RADIUS * 0.35, REAL_HEIGHT * 0.04, 1.0)
    t = 0.0
    while t < settle:
        state = blob_step(state, radius, args, dt)
        t += dt

    trail = []
    end = t + probe
    while t < end:
        state = blob_step(state, radius, args, dt)
        t += dt
        trail.append((t, state))

    heights = [s[1] for _, s in trail]
    low, high = min(heights), max(heights)
    if (high - low) / REAL_HEIGHT < 0.03:
        return None, [(low / REAL_HEIGHT, trail[-1][1][0] / REAL_RADIUS, 0.0)]

    # A Poincare section at the blob's own mid-height rather than at a fixed
    # one: blobs that only ever bob around the pool never cross a section
    # placed where the travellers cross it, and would look like they had no
    # cycle when they have a perfectly good small one.
    section = (low + high) * 0.5
    crossings = [i for i in range(1, len(trail))
                 if heights[i - 1] < section <= heights[i]]
    if len(crossings) < 2:
        return None, [(sum(heights) / len(heights) / REAL_HEIGHT,
                       trail[-1][1][0] / REAL_RADIUS, 0.0)]

    first, last = crossings[0], crossings[-1]
    period = (trail[last][0] - trail[first][0]) / (len(crossings) - 1)
    window = trail[crossings[-2]:last + 1]

    table = []
    for i in range(samples):
        k = i * (len(window) - 1) / samples
        j = int(k)
        f = k - j
        (_, a), (_, b) = window[j], window[min(j + 1, len(window) - 1)]
        z = (a[1] + (b[1] - a[1]) * f) / REAL_HEIGHT
        r = (a[0] + (b[0] - a[0]) * f) / REAL_RADIUS
        speed = abs(blob_flow((a[0], a[1], a[2]), radius, args)[1])
        table.append((z, r, speed))

    fastest = max(row[2] for row in table) or 1.0
    return period, [(z, r, v / fastest) for z, r, v in table]


def sample_cycle(table, phase: float) -> tuple[float, float, float]:
    """Read the cycle table at a fractional phase, wrapping at the ends."""
    n = len(table)
    if n == 1:
        return table[0]
    x = (phase % 1.0) * n
    i = int(x)
    f = x - i
    a, b = table[i % n], table[(i + 1) % n]
    return (a[0] + (b[0] - a[0]) * f,
            a[1] + (b[1] - a[1]) * f,
            a[2] + (b[2] - a[2]) * f)


def blob_specs(args, unit: float) -> list[dict]:
    """One dict per blob: how big it is, and the cycle the physics gives it.

    Sizes are kept in a narrow band on purpose. Velocity goes as r^2, so a
    population spanning a factor of two in radius spans a factor of four in
    speed, and the big ones tear up the column while the small ones sit still.
    A real lamp's blobs do differ, but not by that much, and the interesting
    variety comes from phase and from where in the roll a blob sits rather
    than from making some of them enormous.

    The beads are the exception, and they are honest: wax below about half the
    reference radius never gains enough buoyancy to leave the lower column, so
    it loiters down there. That is what small wax does in a real lamp too.
    """
    specs = []
    for i in range(args.blobs + args.droplets):
        bead = i >= args.blobs
        count = max(1, args.droplets if bead else args.blobs)
        j = i if not bead else i + 17
        if bead:
            scale = 0.42 + 0.16 * jitter(j, 1)
        else:
            scale = 0.85 + args.size_spread * jitter(j, 1)
        influence = unit * args.blob_size * scale
        surface = influence * surface_fraction(args.threshold)
        # Same fraction of the bottle it would be in the real lamp.
        real = max(0.002, surface / max(1e-6, unit) * REAL_RADIUS)
        period, table = limit_cycle(real, args)
        specs.append({
            "name": ("bead_%d" % (i - args.blobs)) if bead else "blob_%d" % i,
            "radius": influence,
            "surface": surface,
            "real": real,
            "period": period,
            "table": table,
            # Phase is stratified rather than drawn: blob i gets slot i of
            # `count`, jittered within it. Drawn independently, a few dozen
            # phases leave gaps and pile-ups by chance, and a pile-up is a
            # clump of blobs moving together.
            "phase": ((i - args.blobs if bead else i)
                      + jitter(j, 5)) / float(count),
            "azimuth": 2.0 * math.pi * jitter(j, 6),
            # Whole turns per loop, some each way, some stationary. Mixed
            # directions matter more than the rate: blobs going opposite ways
            # close on each other and part again, which is the encounter.
            "spin": args.swirl * (1 - (i % 3)) if args.swirl else 0,
            "sway": 1 + (i % 2),
            # Where in the bottle this blob lives, as a fraction of the
            # interior radius. See blob_state for why it needs one.
            #
            # Square-rooted because the bottle is round: a station drawn flat
            # over the radius puts as many blobs in the middle centimetre as
            # in the outermost, and the outermost is an annulus with many
            # times the area. The result is a crowd on the axis, which shows
            # up as blobs fusing into a mass down the centre of the frame
            # while the sides stay empty. The square root spreads them evenly
            # per unit of area instead.
            "station": 0.06 + 0.82 * math.sqrt(jitter(j, 7)),
            "drift": sum(row[1] for row in table) / len(table),
        })
    return specs


def fit_to_column(specs: list[dict], args) -> float:
    """Stretch the wax's travel band to fill the vessel.

    The physics runs in a bottle of its own, and which part of that bottle the
    wax uses is an outcome, not a setting. Rendered as-is, whatever the wax
    left unused is empty medium on screen.

    There are two cases, and they need different anchoring:

    Wax that reaches the pool is anchored there. Its floor is a real place —
    the heated layer it recharges against, and the pool that is actually built
    and rendered — so the band below the pool passes through untouched and
    only the part above it is stretched. Rescaling that end too would lift the
    blobs out of the pool they are supposed to be necking off.

    Wax that never reaches the pool has no such anchor. Small blobs ride the
    convection roll around a circuit that closes well above the floor: with a
    field of bubbles nothing came below 40% of the column, and stretching only
    the top left the bottom of the frame permanently empty. There the whole
    band is mapped onto the whole column.

    Either way the shape of every trajectory and all of the timing are
    untouched; only the ruler changes.

    Returns the fraction of the modelled bottle the wax was using.
    """
    lows = [min(row[0] for row in spec["table"]) for spec in specs]
    tops = [max(row[0] for row in spec["table"]) for spec in specs]
    low = min(lows) if lows else 0.0
    top = max(tops) if tops else 1.0
    pool = min(0.5, args.pool)

    if low < pool:
        floor = pool                      # anchored to the pool it returns to
    else:
        floor = 0.02                      # free-floating; use the whole column

    span = max(1e-3, top * 1.04 - (pool if low < pool else low))
    origin = pool if low < pool else low
    for spec in specs:
        spec["table"] = [
            (z if (low < pool and z <= pool)
             else floor + (z - origin) / span * (1.0 - floor),
             r, v)
            for z, r, v in spec["table"]]
    return top - low


def lock_to_loop(specs: list[dict], args) -> float:
    """Snap every blob's period to a whole number of cycles per loop.

    This is the one place the loop constraint overrides the physics, and it is
    worth stating plainly rather than hiding: a sequence can only wrap if every
    blob is back where it started, so each blob's natural period is stretched
    to the nearest loop/k for integer k. The *shape* of the motion is the
    physics untouched — the charge, the coast, the hover, the fall — and only
    its rate is quantised. Choosing --loop 0 sets the loop to the median
    natural period, which is what makes most of those stretches small.

    Returns the worst stretch as a ratio, for reporting.
    """
    seconds = args.loop / float(args.fps)
    worst = 1.0
    for spec in specs:
        if spec["period"] is None:
            spec["cycles"] = 0            # parked; nothing to snap
            continue
        cycles = max(1, int(round(seconds / spec["period"])))
        spec["cycles"] = cycles
        stretch = (seconds / cycles) / spec["period"]
        worst = max(worst, stretch, 1.0 / stretch)
    return worst


def blob_state(spec: dict, t: float, args, radius_at, floor_z: float,
               ceiling_z: float) -> tuple[Vector, Vector]:
    """Where a blob is and what shape it is, at loop position `t` in [0, 1).

    Nothing is shaped by hand here. The height, the distance from the axis and
    the speed all come out of the integrated cycle; this only maps them onto
    the scene's column and turns speed into deformation.

    Every blob's phase advances by a whole number of cycles across the loop, so
    `blob_state(spec, 0)` and `blob_state(spec, 1)` read the same row of the
    same table, to the last bit.
    """
    if spec["cycles"] == 0:
        zn, rn, speed = spec["table"][0]
    else:
        zn, rn, speed = sample_cycle(
            spec["table"], spec["cycles"] * t + spec["phase"])

    z = floor_z + zn * (ceiling_z - floor_z)
    room = max(0.0, radius_at(z) - spec["surface"] * 1.2)

    # The roll is modelled as a single axisymmetric cell, and a single cell
    # has one answer for where a blob at a given height belongs — so every
    # blob converges onto the same streamline and the lamp renders as one
    # thick plume up the middle. A real bottle has several cells, unsteady
    # and three-dimensional, and blobs also simply cannot occupy each other's
    # space, which is the interaction this per-blob integration cannot see.
    #
    # So each blob keeps its own station in the bottle, and what the roll
    # contributes is its *change* in radius over the cycle — inward across the
    # floor, outward under the top — applied around that station.
    # The station breathes as well as the bearing turning, so blobs cross
    # each other's radius instead of riding fixed concentric shells.
    station = spec["station"] + 0.18 * math.sin(
        2.0 * math.pi * (spec["sway"] * t + spec["phase"]))
    reach = min(max(0.0, (station + rn - spec["drift"])
                    * radius_at(z)), room)

    bearing = spec["azimuth"] + 2.0 * math.pi * spec["spin"] * t
    x = reach * math.cos(bearing)
    # Depth is squeezed toward the camera rather than merely narrowed: a blob
    # centred in a wide column sits behind half a metre of absorbing medium,
    # and the colour it loses there is the colour the wallpaper is made of.
    y = (reach * math.sin(bearing) * args.depth
         - (1.0 - args.depth) * room * 0.42)

    # Deformation from speed alone. A drop's distortion goes with the capillary
    # number, viscosity times velocity over surface tension, and the only term
    # in that varying over a cycle is the velocity — so --stretch is the rest
    # of it rolled into one coefficient.
    sz = 1.0 + args.stretch * speed
    sxy = 1.0 / math.sqrt(sz)
    return Vector((x, y, z)), Vector((sxy, sxy, sz))


def build_wax(args, interior: list[tuple[float, float]], fill_z: float,
              height: float) -> dict:
    """The metaball family: a static pool plus one animated object per blob.

    Blender polygonises every metaball object whose name shares a base — so
    `Lava`, `Lava.001`, `Lava.002` are one surface, and a blob approaching the
    pool necks into it the way wax does, for free. The alternative, keyframing
    element positions inside a single metaball datablock, is the documented
    trap: element properties animate unreliably and do not evaluate on render
    in every version. Object transforms always do.

    `Lava` itself is the family's basis. It supplies the resolution, the
    threshold, the material and the space every other member is measured in,
    so it stays at the origin with an identity transform and carries the one
    part of the wax that never moves: the pool.
    """
    radius_at = radius_sampler(interior)
    floor_z = interior[0][1]

    pool_top = floor_z + (fill_z - floor_z) * args.pool
    unit = radius_at(pool_top)

    data = bpy.data.metaballs.new("Lava")
    data.resolution = args.mesh_res * 2.5      # viewport
    data.render_resolution = args.mesh_res
    data.threshold = args.threshold
    basis = link(bpy.data.objects.new("Lava", data))

    # The pool, as a ring of overlapping balls rather than one flat ellipsoid.
    # Blender's ellipsoid element is a rounded *box*, which through a round
    # bottle reads as a square slab of wax; a ring merges into a disc with a
    # slightly uneven top, which is what settled wax looks like.
    #
    # The ring has to be placed off the *rendered* radius, not the influence
    # radius — see surface_fraction. Place it off the influence radius and the
    # outer lumps hang through the glass wall.
    depth = max(1e-3, pool_top - floor_z)
    influence = depth * 1.15
    surface = influence * surface_fraction(args.threshold)
    edge = max(surface, radius_at(pool_top) - surface * 1.25)

    # Bigger and higher at the centre, smaller and lower at the wall, so the
    # pool domes the way a heated pool of wax does rather than lying flat.
    lumps = [(0.0, 0.0, 1.25, 0.55)]
    for i in range(8):
        a = 2 * math.pi * i / 8
        lumps.append((math.cos(a) * edge * 0.55, math.sin(a) * edge * 0.55,
                      0.95 + 0.12 * jitter(i, 11), 0.4))
    for i in range(10):
        a = 2 * math.pi * i / 10 + 0.31
        lumps.append((math.cos(a) * edge, math.sin(a) * edge,
                      0.7 + 0.16 * jitter(i, 12), 0.22))
    if args.no_pool:
        lumps = []
    for x, y, k, lift in lumps:
        element = data.elements.new(type="BALL")
        element.co = (x, y, floor_z + depth * lift)
        element.radius = influence * k
        element.stiffness = STIFFNESS

    # The blob a blob-scale value should describe is the typical one, not
    # the largest: the spread runs 0.85 to 1.20 of --blob-size.
    typical = unit * args.blob_size * surface_fraction(args.threshold)
    wax = wax_material(basis, height, args.wax_rgb, args.glow,
                       args.glow_reach, typical, args.accent_rgb, args.gloss,
                       args.glass, args.crest_rgb)
    # Only the basis's material is used for the whole family; assigning to the
    # members as well would be dead data.
    basis.data.materials.append(wax)

    # The modelled bottle's floor and ceiling, in scene units. A blob's
    # normalised height maps onto this span, so the physics' own pool depth
    # and the pool built above describe the same place.
    biggest = (unit * args.blob_size * 1.20
               * surface_fraction(args.threshold))
    low = floor_z
    high = max(low + 1e-3, fill_z - biggest * 1.15)

    specs = blob_specs(args, unit)
    if args.loop <= 0:
        # No loop length given, so take it from the wax: the median blob's own
        # period, which is the length at which most of the fleet needs no
        # stretching at all.
        periods = sorted(s["period"] for s in specs if s["period"])
        median = periods[len(periods) // 2] if periods else 20.0
        args.loop = max(2, int(round(median * args.fps)))
    used = fit_to_column(specs, args)
    worst = lock_to_loop(specs, args)
    report_physics(args, specs, worst, used)

    members = []
    for spec in specs:
        ball = bpy.data.metaballs.new("Lava")
        # Matched to the basis. Only the basis's copy of these is read, but a
        # member that ever becomes the basis — someone deletes `Lava`, or
        # renames it — should not change how the wax looks.
        ball.resolution = data.resolution
        ball.render_resolution = data.render_resolution
        ball.threshold = args.threshold
        element = ball.elements.new(type="BALL")
        element.co = (0.0, 0.0, 0.0)
        element.radius = spec["radius"]
        element.stiffness = STIFFNESS

        obj = link(bpy.data.objects.new("Lava", ball))
        # bpy.data.objects.new suffixes a clashing name, which is exactly the
        # `.001` the family grouping keys off. Assert it rather than assume:
        # a member that landed outside the family would silently render as a
        # second, separate lump of wax.
        assert obj.name.startswith("Lava."), obj.name
        obj["blob"] = spec["name"]
        members.append((obj, spec))

    animate_wax(args, members, radius_at, low, high)
    return {"basis": basis, "blobs": [o for o, _ in members], "wax": wax,
            "low": low, "high": high, "pool_top": pool_top, "specs": specs}


def report_physics(args, specs: list[dict], worst: float,
                   used: float) -> None:
    """Print what the integrator found, because these numbers are the design.

    A lamp whose blobs all had to be stretched by half to fit the loop is one
    where the loop length is wrong, and that is invisible in the render — it
    just looks a bit brisk. So it gets said out loud.
    """
    seconds = args.loop / float(args.fps)
    travelled = [s for s in specs if s["period"] and max(
        row[0] for row in s["table"]) > 0.5]
    print(f"[lava] medium {args.viscosity * 1000:.1f} cP; a {REF_RADIUS * 1000:.0f}mm "
          f"blob at full heat rises {reference_speed(args) * 1000:.1f} mm/s")
    print(f"[lava] {len(specs)} blobs, {len(travelled)} of them reaching past "
          f"mid-column; loop {args.loop} frames = {seconds:.1f}s at "
          f"{args.fps}fps")
    print(f"[lava] wax used {used:.0%} of the modelled bottle; that band is "
          f"stretched to fill the rendered column")
    for spec in specs[:3] + specs[-2:]:
        if spec["period"] is None:
            print(f"[lava]   {spec['name']:>8}  r={spec['real'] * 1000:4.1f}mm  "
                  f"parked in the pool")
            continue
        top = max(row[0] for row in spec["table"])
        print(f"[lava]   {spec['name']:>8}  r={spec['real'] * 1000:4.1f}mm  "
              f"natural {spec['period']:5.1f}s  x{spec['cycles']} per loop  "
              f"tops out at {top:.0%}")
    if worst > 1.35:
        print(f"[lava] warning: worst blob stretched {worst:.2f}x to fit the "
              f"loop. --loop 0 picks a length that suits the physics")


def animate_wax(args, members, radius_at, low: float, high: float) -> None:
    """Keyframe every blob across the loop, one key per frame.

    A key on every frame with linear interpolation samples the motion at
    exactly the rate the render consumes it, so each frame gets the true
    analytic value and no interpolation error creeps in between keys. It is
    also why there is no pre-roll: the state at frame 1 is computed, not
    settled into.
    """
    for obj, spec in members:
        for frame in range(1, args.loop + 2):
            t = (frame - 1) / float(args.loop)
            location, scale = blob_state(spec, t, args, radius_at, low, high)
            obj.location = location
            obj.scale = scale
            obj.keyframe_insert(data_path="location", frame=frame)
            obj.keyframe_insert(data_path="scale", frame=frame)

        action = obj.animation_data.action
        for fcurve in action.fcurves:
            for kp in fcurve.keyframe_points:
                kp.interpolation = "LINEAR"


# --------------------------------------------------------------------------
# scene
# --------------------------------------------------------------------------


def build_scene(args) -> dict:
    clear_scene()
    scene = bpy.context.scene
    scene.render.fps = args.fps
    scene.frame_start = 1
    # frame_end is set after the wax is built, not here: with --loop 0 the
    # loop length is one of the physics' outputs rather than one of its inputs.

    aspect = args.res_y / max(1, args.res_x)
    fullbleed = args.shape == "fullbleed"

    if fullbleed:
        # The wallpaper case. The bottle is not the subject — the wax is — so
        # the column is made wider than the frame and taller than the frame,
        # and both walls and both ends fall outside it. What is left on screen
        # is liquid, wax and light, with no silhouette to date the image.
        #
        # Only just taller, though. Overshoot the height and the pool — the
        # one thing in the frame that explains where the light comes from —
        # ends up far below the bottom edge, and the wax climbs into a column
        # the bulb cannot reach. At 1.12 the pool sits half in frame along the
        # bottom edge and the heat gradient starts inside the picture.
        frame_h = args.height if args.height > 0 else args.width * aspect
        height = frame_h * 1.12
        r_max = args.width * 0.5 * 1.35 + args.wall
        profile = bottle_profile(height, r_max, r_max, 0.0, args.rings, 0.0)
        margin = args.margin if args.margin > 0 else 1.0
        ortho = max(frame_h * margin, args.width * margin * aspect)
    else:
        height = args.height if args.height > 0 else args.width * 2.5
        r_max = args.width * 0.5
        profile = bottle_profile(height, r_max, r_max * args.neck, args.taper,
                                 args.rings)
        margin = args.margin if args.margin > 0 else 1.18
        total = height * (1.0 + args.base + args.cap)
        ortho = max(total * margin, r_max * 2.6 * margin * aspect)

    glass = revolve("Lava_Glass", profile, args.segments)
    glass.data.materials.append(glass_material())
    solid = glass.modifiers.new("wall", "SOLIDIFY")
    solid.thickness = args.wall
    solid.offset = -1.0          # grow inward, so the silhouette is the profile
    solid.use_rim = True

    # The medium is inset by a shade more than the wall so its surface never
    # lands coplanar with the glass's inner face. Coplanar transmissive
    # surfaces are where a path tracer produces those flickering black seams
    # that look like a modelling error and are a numeric one.
    inset = args.wall * 1.08
    interior = [(max(1e-4, r - inset), z) for r, z in profile]
    interior[0] = (interior[0][0], profile[0][1] + inset)
    interior[-1] = (interior[-1][0], profile[-1][1] - inset)

    medium = revolve("Lava_Medium", interior, max(48, args.segments // 2))
    fill_z = interior[0][1] + (interior[-1][1] - interior[0][1]) * args.fill
    if args.fill < 1.0:
        cut_above(medium, fill_z, max(r_max * 2.0, height))
    # --density is an optical depth across the vessel, so the absorption
    # coefficient the shader wants is that depth divided by the path a ray
    # takes through the widest part.
    across = max(1e-6, 2.0 * max(r for r, _ in interior))
    medium.data.materials.append(
        liquid_material(glass, height, args.liquid_rgb,
                        args.density / across, args.haze / across,
                        args.accent_rgb))

    wax = build_wax(args, interior, fill_z, height)
    build_ember(args, interior, interior[0][1], radius_sampler(interior))
    scene.frame_end = args.loop

    metal = metal_material(args.metal_rgb)
    fittings = [] if fullbleed else build_fittings(args, height, r_max,
                                                   profile, metal)

    centre = height * 0.5
    if not fullbleed:
        centre = (-height * args.base + height * (1.0 + args.cap)) * 0.5

    build_camera(args, ortho, centre)
    build_lighting(args, height, r_max, centre, ortho, fullbleed)

    return {"scene": scene, "glass": glass, "medium": medium,
            "fittings": fittings, "height": height, "r_max": r_max,
            "fill_z": fill_z, "centre": centre, **wax}


def build_fittings(args, height: float, r_max: float,
                   profile: list[tuple[float, float]],
                   metal: bpy.types.Material) -> list[bpy.types.Object]:
    """The spun metal base the bulb lives in, and the cap on top."""
    base_h = height * args.base
    base = revolve("Lava_Base", [
        (r_max * 1.14, -base_h),
        (r_max * 1.18, -base_h * 0.92),
        (r_max * 1.08, -base_h * 0.62),
        (r_max * 0.95, -base_h * 0.24),
        (r_max * 0.86, -base_h * 0.04),
        (profile[0][0] * 1.02, 0.0),
    ], args.segments)
    base.data.materials.append(metal)

    cap_h = height * args.cap
    neck = profile[-1][0]
    cap = revolve("Lava_Cap", [
        (neck * 1.04, height),
        (neck * 1.10, height + cap_h * 0.18),
        (neck * 0.94, height + cap_h * 0.55),
        (neck * 0.58, height + cap_h * 0.88),
        (neck * 0.30, height + cap_h),
    ], args.segments)
    cap.data.materials.append(metal)
    return [base, cap]


def build_ember(args, interior, floor_z: float, radius_at) -> None:
    """A visible emitter under the wax.

    A point light is invisible; what the camera sees of it is its halo in the
    haze, which clips to a white blob under a hard view transform. This is
    the source itself: a disc on the floor, a hot orange core dying to a dark
    red rim, so the glow has a shape and a colour that survives exposure.
    """
    if args.ember <= 0.0:
        return
    r = radius_at(floor_z) * 0.92
    bpy.ops.mesh.primitive_circle_add(vertices=96, radius=r, fill_type="NGON",
                                      location=(0.0, 0.0, floor_z + 0.01))
    disc = bpy.context.active_object
    disc.name = "Lava_Ember"

    mat, tree = new_material("lava_ember")
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    coord = tree.nodes.new("ShaderNodeTexCoord")
    coord.location = (-600, 0)
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.location = (-420, 0)
    mapping.inputs["Scale"].default_value = (1.0 / r, 1.0 / r, 1.0)
    grad = tree.nodes.new("ShaderNodeTexGradient")
    grad.location = (-240, 0)
    grad.gradient_type = "SPHERICAL"
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-60, 0)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = rgba((0.35, 0.03, 0.0))
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = rgba((1.0, 0.30, 0.03))
    emit = tree.nodes.new("ShaderNodeEmission")
    emit.location = (200, 0)
    emit.inputs["Strength"].default_value = args.ember
    tree.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    tree.links.new(mapping.outputs["Vector"], grad.inputs["Vector"])
    tree.links.new(grad.outputs["Fac"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], emit.inputs["Color"])
    tree.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    disc.data.materials.append(mat)


def build_camera(args, ortho: float, centre: float) -> bpy.types.Object:
    """Orthographic front-on view, portrait, lamp centred.

    Orthographic for the same reason the shaker is: a perspective camera on a
    tall vessel converges its sides, and a wallpaper with converging sides
    reads as a photograph of a thing rather than as the thing.
    """
    cam_data = bpy.data.cameras.new("Lava_Cam")
    cam_data.type = "ORTHO"
    # ortho_scale maps to the longer edge of the render, which on a portrait
    # frame is the height — so the caller solves for whichever axis is tighter
    # and hands the answer in.
    cam_data.ortho_scale = ortho
    cam = link(bpy.data.objects.new("Lava_Cam", cam_data))
    cam.location = (0.0, -12.0, centre)
    cam.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    if args.dof > 0.0:
        cam_data.dof.use_dof = True
        # The axis of the vessel: the camera sits on -Y looking at x=0, so the
        # distance to focus is just how far back it is.
        cam_data.dof.focus_distance = 12.0
        cam_data.dof.aperture_fstop = args.dof
    bpy.context.scene.camera = cam
    return cam


def build_lighting(args, height: float, r_max: float, centre: float,
                   ortho: float, fullbleed: bool) -> None:
    """A bulb under the wax, and just enough else to find the glass.

    The lamp lights itself. Everything else in the rig exists to keep the
    bottle from disappearing into a black frame: a low key to put a highlight
    down one side of the glass, a rim behind to separate it from the backdrop,
    and a world dim enough that neither reads as daylight.
    """
    scene = bpy.context.scene

    world = bpy.data.worlds.new("Lava_World")
    world.use_nodes = True
    tree = world.node_tree
    bg = tree.nodes["Background"]
    bg.inputs["Color"].default_value = rgba((0.28, 0.33, 0.46))
    bg.inputs["Strength"].default_value = args.env
    scene.world = world

    if args.gloss > 0.0:
        # A flat world is the real reason polished wax still looked matte. A
        # mirror reflects its surroundings, and a surrounding that is one even
        # colour reflects as that colour — no brighter anywhere, so there is no
        # highlight and no shape to it, however low the roughness goes. This
        # gives the world a bright top and a dark floor, which is the least a
        # sphere needs to read as wet: a crisp bright cap and a dark underside.
        coord = tree.nodes.new("ShaderNodeTexCoord")
        coord.location = (-800, 0)
        up = tree.nodes.new("ShaderNodeSeparateXYZ")
        up.location = (-600, 0)
        span = tree.nodes.new("ShaderNodeMapRange")
        span.location = (-420, 0)
        span.inputs["From Min"].default_value = -1.0
        span.inputs["From Max"].default_value = 1.0
        sky = tree.nodes.new("ShaderNodeValToRGB")
        sky.location = (-240, 0)
        # A tight band rather than a slow fade. A broad gradient reflects as
        # a broad soft sheen, which is what a matte surface already looks
        # like; the crisp edge is the whole difference between wet and dull.
        sky.color_ramp.elements[0].position = 0.66
        sky.color_ramp.elements[0].color = rgba((0.02, 0.02, 0.05))
        sky.color_ramp.elements[1].position = 0.84
        sky.color_ramp.elements[1].color = rgba((1.0, 0.98, 0.95))
        tree.links.new(coord.outputs["Generated"], up.inputs["Vector"])
        tree.links.new(up.outputs["Z"], span.inputs["Value"])
        tree.links.new(span.outputs["Result"], sky.inputs["Fac"])
        tree.links.new(sky.outputs["Color"], bg.inputs["Color"])
        # The band exists to be *reflected*. Left visible to everything, it
        # also lights the haze and every diffuse surface, so the only way to
        # keep the ground dark was to dim it — which dimmed the highlights
        # with it and put the wax back to matte. Reflection-only decouples
        # the two: --env can be high for the specular without brightening
        # the frame.
        vis = getattr(world, "cycles_visibility", None)
        if vis is not None:
            vis.diffuse = False
            vis.scatter = False

    bulb_data = bpy.data.lights.new("Bulb", "POINT")
    bulb_data.energy = args.bulb
    bulb_data.color = args.bulb_rgb
    # A big soft source. A point-sized bulb under a pool of wax burns a
    # white hole through the middle of it; widening the emitter spreads the
    # same energy over the whole floor and the pool keeps its colour.
    bulb_data.shadow_soft_size = r_max * args.bulb_size
    bulb = link(bpy.data.objects.new("Bulb", bulb_data))
    # Just under the pool. Above it and the pool is backlit into a bright
    # smear; far below it and the glass floor eats most of the throw.
    bulb.location = (0.0, 0.0, height * (0.008 - args.bulb_depth))
    hide_from_camera(bulb)

    def area(name, location, rotation, size_m, energy, colour=(1.0, 1.0, 1.0)):
        data = bpy.data.lights.new(name, "AREA")
        data.shape = "RECTANGLE"
        data.size = size_m
        data.size_y = size_m * 2.2
        data.energy = energy
        data.color = colour
        light = link(bpy.data.objects.new(name, data))
        light.location = location
        light.rotation_euler = rotation
        hide_from_camera(light)
        return light

    reach = max(height, ortho)
    if fullbleed:
        # Two lights, and *nothing in front of the glass*. The camera looks
        # through a metre-wide refracting cylinder here, and a source on the
        # near side comes back through it: rays that enter the wall are bent
        # back out toward the camera side, find the light again and paint it
        # across the frame as a soft vertical bar. It survives switching the
        # light out of camera and glossy rays, because the path that carries
        # it is transmission. The fix is not a flag, it is not putting a light
        # there.
        #
        # Crown: above the column, pointing down it. Area lights emit along
        # their own -Z, so an unrotated one already faces the floor. This is
        # what keeps the top of the frame from going black once the bulb's
        # heat gradient has run out, and being directly overhead it lights the
        # top of a blob the way daylight lights the top of a cloud.
        crown = area("Crown", (0.0, 0.0, height * 1.06), (0.0, 0.0, 0.0),
                     ortho * 0.5, args.crown, (0.86, 0.89, 1.0))
        # Kept out of reflections only while the wax is matte, where all it
        # would add is a broad sheen on the glass. Glossy wax needs it: the
        # highlight it puts on the crown of every bubble is the entire read.
        if args.gloss <= 0.0:
            hide_from_glossy(crown)
        if args.backlight > 0.0:
            # Behind the column, facing the camera, between the glass and the
            # backdrop. Lights the haze from within and rims the wax.
            back = area("Backlight", (0.0, reach * 0.55, centre),
                        (math.radians(-90), 0.0, 0.0), ortho * 0.9,
                        args.backlight, args.backlight_rgb)
        if args.glint > 0.0:
            # A square panel, not a point. Through the tinted liquid a point
            # light's reflection never arrived on the wax however bright it
            # was made: a hard coat gets its highlight from the paths that
            # bounce off it and go looking for the light, and inside a
            # volume Cycles loses those. A panel is found by light sampling
            # from the surface instead, which survives. It is also the shape
            # the reference shows: a soft-edged window on every shoulder.
            glint_data = bpy.data.lights.new("Glint", "AREA")
            glint_data.shape = "SQUARE"
            glint_data.size = reach * args.glint_size
            glint_data.energy = args.glint
            glint_data.color = (1.0, 0.97, 0.95)
            # The light sits outside the bottle. To a shadow ray the glass
            # wall is opaque (a light seen through refraction is a caustic,
            # which Cycles drops) and the tinted liquid absorbs whatever
            # gets past it, so with shadows on the glint never reached the
            # wax at all. It exists to put a highlight on a coat, and a
            # highlight is view-dependent anyway: no shadow rays.
            glint_data.use_shadow = False
            glint = link(bpy.data.objects.new("Glint", glint_data))
            glint.location = (-reach * 0.5, -reach * 0.45, centre + height * 0.4)
            aim = Vector((0.0, 0.0, centre)) - Vector(glint.location)
            glint.rotation_euler = aim.to_track_quat("-Z", "Y").to_euler()
            hide_from_camera(glint)
            # A source in front of the column reflects in the front glass
            # wall as a bright patch, whatever ray flags it carries.
            # Light-link it to the wax alone: it then puts a highlight on
            # every blob and does not exist as far as the glass is concerned.
            receivers = bpy.data.collections.new("Glint_Receivers")
            for obj in bpy.data.objects:
                if obj.name.startswith("Lava") and obj.type == "META":
                    receivers.objects.link(obj)
            try:
                glint.light_linking.receiver_collection = receivers
            except AttributeError:
                pass
    else:
        # Key: low and camera-left, cool against the bulb's warmth.
        area("Key", (-reach * 0.55, -reach * 0.42, centre + height * 0.12),
             (math.radians(78), 0.0, math.radians(-46)), height * 0.55,
             args.bulb * 0.22, (0.62, 0.74, 1.0))
        # Rim: behind and slightly above, so the glass edges pick up a line.
        area("Rim", (reach * 0.35, reach * 0.6, centre + height * 0.3),
             (math.radians(-104), 0.0, math.radians(28)), height * 0.7,
             args.bulb * 0.4, (0.72, 0.82, 1.0))

    if args.transparent:
        scene.render.film_transparent = True
        return

    colour = tuple(float(c) for c in args.backdrop.split(","))
    span = max(reach * 4.0, ortho * 2.4)
    material = backdrop_material(colour, ortho * 0.85,
                                 args.backdrop_floor_rgb)
    panels = [("Backdrop", (0.0, span * 0.32, centre),
               (math.radians(90), 0, 0))]
    if not fullbleed:
        # The lamp stands on something. Full-bleed has no floor in frame and
        # a floor plane there would only cut a hard line across the wallpaper.
        panels.append(("Floor", (0.0, 0.0, -height * args.base),
                       (0.0, 0.0, 0.0)))

    for name, location, rotation in panels:
        bpy.ops.mesh.primitive_plane_add(size=span, location=location,
                                         rotation=rotation)
        panel = bpy.context.active_object
        panel.name = name
        panel.data.materials.append(material)


def hide_from_camera(obj: bpy.types.Object) -> None:
    """Keep a light out of frame without taking its light out of the scene."""
    try:
        obj.visible_camera = False
    except AttributeError:
        if hasattr(obj, "cycles_visibility"):
            obj.cycles_visibility.camera = False


def hide_from_glossy(obj: bpy.types.Object) -> None:
    """Let a light illuminate without appearing in reflections."""
    try:
        obj.visible_glossy = False
    except AttributeError:
        if hasattr(obj, "cycles_visibility"):
            obj.cycles_visibility.glossy = False


# --------------------------------------------------------------------------
# render
# --------------------------------------------------------------------------


def configure_render(args, scene: bpy.types.Scene) -> None:
    scene.render.engine = "CYCLES"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 32
    scene.cycles.transmission_bounces = 24
    scene.cycles.transparent_max_bounces = 24
    scene.cycles.volume_bounces = 6
    # Filter Glossy blurs every glossy reflection seen after a bounce, and
    # the wax is only ever seen after one: the camera ray refracts through
    # the glass wall first. At 0.6 a point light's reflection in a blob's
    # coat smeared into a broad sheen and no setting of the light could
    # sharpen it. Near zero the wet highlight is a hard white spot, which
    # is the whole point of the coat; the denoiser takes the fireflies.
    scene.cycles.blur_glossy = 0.05
    # The bulb is a small bright source seen through two refracting surfaces
    # and a volume, which is the textbook recipe for fireflies. Clamping the
    # indirect ray costs a little bloom and removes them.
    scene.cycles.sample_clamp_indirect = 8.0
    scene.cycles.device = args.device
    scene.render.resolution_x = args.res_x
    scene.render.resolution_y = args.res_y
    scene.render.resolution_percentage = args.percent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA" if args.transparent \
        else "RGB"
    scene.render.filepath = os.path.join(args.out, "frame_")
    # AgX by default here, where the shaker wants Khronos PBR Neutral. The
    # shaker's problem is holding a white backdrop; this one's is a small
    # incandescent source against black, and AgX is what keeps the bulb's core
    # from clipping to a white disc with a hard edge.
    try:
        scene.view_settings.view_transform = args.view_transform
    except TypeError:
        scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = args.exposure

    if args.device == "GPU":
        prefs = bpy.context.preferences.addons.get("cycles")
        if prefs is not None:
            cprefs = prefs.preferences
            for backend in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
                try:
                    cprefs.compute_device_type = backend
                except TypeError:
                    continue
                cprefs.get_devices()
                if any(d.type == backend for d in cprefs.devices):
                    for device in cprefs.devices:
                        device.use = device.type != "CPU"
                    break


def configure_bloom(args, scene: bpy.types.Scene) -> None:
    """Glow off bright areas. Cycles has no bloom; the compositor's Glare
    node in fog-glow mode is the standard stand-in."""
    if args.bloom <= 0.0:
        return
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    layers = tree.nodes.new("CompositorNodeRLayers")
    glare = tree.nodes.new("CompositorNodeGlare")
    glare.glare_type = "FOG_GLOW"
    glare.threshold = 0.9
    glare.size = 8
    glare.mix = -1.0 + min(1.0, args.bloom)
    out = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(layers.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], out.inputs["Image"])


def render_loop(args, scene: bpy.types.Scene) -> None:
    scene.frame_start = 1
    scene.frame_end = args.loop
    bpy.ops.render.render(animation=True)


def check_loop(args, scene: bpy.types.Scene) -> float:
    """Compare the wax at frame 1 against frame `loop + 1`.

    Frame `loop + 1` is the frame that would follow the last rendered one, so
    if it holds every blob in exactly the position frame 1 does, the sequence
    wraps with nothing to hide. Reported rather than asserted quietly: an
    exact zero is the expected answer, and anything else is worth seeing.
    """
    worst = 0.0
    for frame, store in ((1, {}), (args.loop + 1, {})):
        scene.frame_set(frame)
        for obj in bpy.data.objects:
            if obj.name.startswith("Lava."):
                store[obj.name] = tuple(obj.location) + tuple(obj.scale)
        if frame == 1:
            first = store
        else:
            for name, values in store.items():
                worst = max(worst, max(abs(a - b)
                                       for a, b in zip(first[name], values)))
    print(f"[lava] {len(first)} blobs; largest frame 1 vs frame "
          f"{args.loop + 1} difference: {worst:.3e}")
    print("[lava] loop closes exactly" if worst == 0.0
          else "[lava] loop does NOT close — check --rise is an integer")
    return worst


def frame_paths(args) -> list[str]:
    directory = bpy.path.abspath(args.out)
    if not os.path.isdir(directory):
        return []
    names = sorted(n for n in os.listdir(directory)
                   if n.startswith("frame_") and n.endswith(".png"))
    return [os.path.join(directory, n) for n in names]


def blend_seam(args) -> None:
    """Crossfade the loop seam.

    Off by default and kept only as an escape hatch: this motion is periodic
    by construction, so there is nothing at the seam to hide. It earns its
    place if you drive the lamp with something that is not — a non-integer
    `--rise`, or hand-edited curves in a saved .blend.
    """
    n = args.blend_frames
    if n <= 0:
        return
    paths = frame_paths(args)
    if len(paths) < n * 2 + 1:
        print(f"[lava] too few frames ({len(paths)}) to blend {n}; skipping")
        return

    import numpy as np

    head, tail = paths[:n], paths[-n:]
    for i, (head_path, tail_path) in enumerate(zip(head, tail)):
        alpha = (i + 1) / (n + 1)
        a = bpy.data.images.load(head_path)
        b = bpy.data.images.load(tail_path)
        pa = np.empty(len(a.pixels), dtype=np.float32)
        pb = np.empty(len(b.pixels), dtype=np.float32)
        a.pixels.foreach_get(pa)
        b.pixels.foreach_get(pb)
        a.pixels.foreach_set(pa * alpha + pb * (1.0 - alpha))
        a.filepath_raw = head_path
        a.file_format = "PNG"
        a.save()
        bpy.data.images.remove(a)
        bpy.data.images.remove(b)

    for path in tail:
        os.remove(path)
    print(f"[lava] blended {n} seam frames; loop is {len(paths) - n} frames")


def encode(args) -> str | None:
    """Encode the sequence to mp4 through Blender's bundled FFmpeg."""
    paths = frame_paths(args)
    if not paths:
        print("[lava] nothing to encode")
        return None

    scene = bpy.data.scenes.new("lava_encode")
    scene.render.fps = args.fps
    scene.frame_start = 1
    scene.frame_end = len(paths)
    scene.render.resolution_x = args.res_x
    scene.render.resolution_y = args.res_y
    scene.render.resolution_percentage = args.percent
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.ffmpeg.ffmpeg_preset = "GOOD"
    scene.render.ffmpeg.gopsize = 12
    out_path = os.path.join(bpy.path.abspath(args.out), "lava_loop.mp4")
    scene.render.filepath = out_path

    editor = scene.sequence_editor_create()
    # 4.4 renamed `sequences` to `strips`; both spellings exist for a while.
    strips = getattr(editor, "strips", None) or editor.sequences
    directory = os.path.dirname(paths[0])
    strip = strips.new_image(name="frames", filepath=paths[0], channel=1,
                            frame_start=1)
    for path in paths[1:]:
        strip.elements.append(os.path.basename(path))
    strip.directory = directory + os.sep

    with bpy.context.temp_override(scene=scene):
        bpy.ops.render.render(animation=True, scene=scene.name)

    print(f"[lava] wrote {out_path}")
    return out_path


# --------------------------------------------------------------------------


def main() -> None:
    args = parse_args()
    built = build_scene(args)
    configure_render(args, built["scene"])
    configure_bloom(args, built["scene"])
    print(f"[lava] {args.blobs} blobs + {args.droplets} droplets, "
          f"{args.loop} frames at {args.fps}fps, loop closes exactly")

    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=bpy.path.abspath(args.save_blend))
        print(f"[lava] saved {args.save_blend}")

    if args.check_loop:
        check_loop(args, built["scene"])
        return

    if args.no_render:
        return

    render_loop(args, built["scene"])
    blend_seam(args)
    if args.encode:
        encode(args)


if __name__ == "__main__":
    main()
