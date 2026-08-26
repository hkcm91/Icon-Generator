"""
Render presets and output targets.

Two engines, for two different jobs. EEVEE is the one the finished loop is
rendered with: 300 frames of volumetrics and transmission is minutes on a GPU
and hours in a path tracer, and the look this project is after is a stylised
one that does not need correct light transport. Cycles on CPU is here because
it is the only engine that runs without a GPU, which is what a CI box or a
container has — so preview stills stay reproducible anywhere even though the
final render needs a real machine.

Anything that must match between the two (resolution, colour management, frame
range) is set in one place, here.
"""

from __future__ import annotations

from dataclasses import dataclass

import bpy


@dataclass(frozen=True)
class Target:
    """An output size, named after where it is going."""

    name: str
    width: int
    height: int
    note: str


TARGETS = {
    # Portrait phone wallpapers. Taller than the screen on purpose where the
    # launcher pans the wallpaper between home screens.
    "phone": Target("phone", 1440, 3120, "QHD+ 19.5:9 — most 2021+ flagships"),
    "phone-1080": Target("phone-1080", 1080, 2400, "FHD+ — the safe default"),
    "phone-pan": Target("phone-pan", 2160, 2400, "double-width, for launcher parallax"),
    "desktop": Target("desktop", 3840, 2160, "4K 16:9 — Wallpaper Engine, Lively"),
    "desktop-1440": Target("desktop-1440", 2560, 1440, "QHD 16:9"),
    # Small, square, fast. For look development only.
    "preview": Target("preview", 540, 1170, "quick portrait check"),
    "contact": Target("contact", 512, 512, "single-tile look dev"),
}


def apply_target(scene: bpy.types.Scene, target: str, percent: int = 100) -> Target:
    if target not in TARGETS:
        raise SystemExit(f"unknown target {target!r}; choose from {', '.join(TARGETS)}")
    spec = TARGETS[target]
    scene.render.resolution_x = spec.width
    scene.render.resolution_y = spec.height
    scene.render.resolution_percentage = percent
    return spec


def use_cycles(scene: bpy.types.Scene, samples: int = 64, device: str = "CPU") -> None:
    scene.render.engine = "CYCLES"
    scene.cycles.device = device
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 12
    scene.cycles.transmission_bounces = 8
    scene.cycles.volume_bounces = 2


def use_eevee(scene: bpy.types.Scene, samples: int = 64) -> None:
    """
    EEVEE, configured for glass.

    The defaults are wrong for this scene in one specific way: without ray-traced
    or screen-space refraction the tiles render as flat coloured cards, because
    transmission simply is not evaluated. The attribute that turns it on has
    moved twice across 4.x and 5.x, so each known location is tried.
    """
    scene.render.engine = "BLENDER_EEVEE"
    eevee = scene.eevee
    for attr, value in (
        ("taa_render_samples", samples),
        ("use_raytracing", True),  # 4.2+ (EEVEE Next)
        ("use_ssr", True),  # legacy EEVEE
        ("use_ssr_refraction", True),
        ("use_bloom", True),  # legacy; 4.2+ does bloom in compositing
        ("use_volumetric_lights", True),
    ):
        if hasattr(eevee, attr):
            try:
                setattr(eevee, attr, value)
            except (AttributeError, TypeError):
                pass


def apply_loop(scene: bpy.types.Scene, frames: int, fps: int) -> None:
    """
    Frame range for a loop of `frames` frames.

    The end frame is `frames`, not `frames + 1`. Rendering the closing frame
    would duplicate frame 1 and produce a one-frame stutter every cycle — the
    exact defect the loop discipline exists to prevent, reintroduced at the
    last step.
    """
    scene.frame_start = 1
    scene.frame_end = frames
    scene.render.fps = fps


def output_video(scene: bpy.types.Scene, path: str, quality: str = "HIGH") -> None:
    """H.264 in MP4 — what both Wallpaper Engine and Android video wallpapers take."""
    scene.render.filepath = path
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = quality
    scene.render.ffmpeg.ffmpeg_preset = "GOOD"
    scene.render.ffmpeg.gopsize = 12
    scene.render.ffmpeg.audio_codec = "NONE"


def output_frames(scene: bpy.types.Scene, path: str) -> None:
    """
    PNG sequence.

    Slower to write and larger on disk, but it survives an interrupted render
    and it is the only sane input if the loop is going to be graded or
    composited before it is encoded.
    """
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.compression = 15


def colour_management(scene: bpy.types.Scene, look: str = "None") -> None:
    """
    AgX view transform, which is the 4.x+ default and is what keeps the bright
    cyan rim from clipping to white the moment emission goes above 1.
    """
    view = scene.view_settings
    try:
        view.view_transform = "AgX"
    except TypeError:
        view.view_transform = "Filmic"
    try:
        view.look = look
    except TypeError:
        pass
    view.exposure = 0.0
    view.gamma = 1.0
