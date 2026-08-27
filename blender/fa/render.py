"""
Render settings, and the encode rules a looping wallpaper depends on.

Two things here are not preference and will produce a broken wallpaper if
changed casually:

  * **Never render frame L+1.** The loop is frames 1..L inclusive. Encoding
    L+1 frames duplicates frame 1 at the end, which shows as a single stalled
    frame every loop — the most common way a technically-correct loop still
    looks wrong.
  * **Keyframe interval must divide L.** Players seek to a keyframe when they
    wrap. If the GOP does not line up with the loop length the player either
    jumps to the wrong frame or decodes forward from the previous keyframe,
    and the wrap stutters on exactly the machines you did not test on.
"""

from __future__ import annotations

from pathlib import Path

import bpy


def configure(
    scene: bpy.types.Scene,
    width: int = 2560,
    height: int = 1440,
    samples: int = 256,
    engine: str = "CYCLES",
) -> None:
    """Apply the project's standing render settings."""
    scene.render.engine = engine
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False

    if engine == "CYCLES":
        cycles = scene.cycles
        cycles.samples = samples
        cycles.use_denoising = True
        # Adaptive sampling spends its budget on the noisy regions — here the
        # volume and the transmissive glass — instead of on the flat sky.
        cycles.use_adaptive_sampling = True
        cycles.adaptive_threshold = 0.01
        # Transmissive tiles seen through bubbles seen through water surface
        # is three refractive events before anything opaque, so a low
        # transmission bounce count silently turns glass black.
        cycles.transmission_bounces = 12
        cycles.transparent_max_bounces = 16
        cycles.max_bounces = 12
        cycles.volume_bounces = 2
        cycles.caustics_reflective = False
        cycles.caustics_refractive = False

    _configure_colour(scene)

    # No compositor bloom here, deliberately, though the aesthetic wants it.
    #
    # Blender 5 moved the compositor to `scene.compositing_node_group` and
    # turned the Glare node's settings into input sockets. A group built that
    # way through bpy links up correctly — every socket connected, no error —
    # and then the render returns a blank white frame in two seconds, having
    # never traced a path. Not worth shipping a feature that silently destroys
    # the render on one Blender version to save two clicks on another.
    #
    # Add it by hand instead, in the Compositing workspace: a Glare node set
    # to Bloom, threshold ~0.9, size ~8, strength ~0.35, between Render Layers
    # and Composite. Gentle: heavy bloom reads as a 2008 game demo rather than
    # a 2008 advertisement, and the icons still have to stay readable. AgX
    # already rolls the highlights off well, so the scene is not obviously
    # missing anything without it.


def enable_gpu(preferred: tuple[str, ...] = ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI")) -> str:
    """Switch Cycles to GPU rendering. Returns the backend actually enabled.

    A 300-frame loop is the difference between an overnight job and an
    unfinishable one, so this is worth getting right rather than leaving to
    whatever the .blend was saved with.

    Backends are tried in preference order — OPTIX before CUDA because on
    NVIDIA hardware it is materially faster for exactly the things this scene
    is made of, transmission and volume. Returns "CPU" when nothing is
    available, rather than raising: falling back and saying so is more useful
    than refusing to render.
    """
    preferences = bpy.context.preferences.addons.get("cycles")
    if preferences is None:
        return "CPU"

    cycles_prefs = preferences.preferences
    for backend in preferred:
        try:
            cycles_prefs.compute_device_type = backend
        except TypeError:
            continue

        cycles_prefs.get_devices()
        usable = [d for d in cycles_prefs.devices if d.type == backend]
        if not usable:
            continue

        for device in cycles_prefs.devices:
            # Keep the CPU in the pool alongside the GPU: with the GPU doing
            # the bulk, spare cores still shave time off each tile rather than
            # sitting idle for hours.
            device.use = device.type in (backend, "CPU")

        bpy.context.scene.cycles.device = "GPU"
        return backend

    bpy.context.scene.cycles.device = "CPU"
    return "CPU"


def _configure_colour(scene: bpy.types.Scene) -> None:
    """Filmic-family view transform with a lifted, glossy look.

    Blender's default AgX is superb at holding highlights but desaturates them
    hard on the way, and this aesthetic lives on saturated blues staying
    saturated right up into the blowout. Standard clips too readily. So: AgX
    where available, with the look pushed back up.
    """
    view = scene.view_settings
    try:
        view.view_transform = "AgX"
        view.look = "AgX - Medium High Contrast"
    except TypeError:
        view.view_transform = "Filmic"
        view.look = "Medium High Contrast"
    view.exposure = 0.15


def still(
    scene: bpy.types.Scene,
    path: Path,
    frame: int = 1,
    samples: int = 48,
    scale: float = 0.25,
) -> Path:
    """Render one frame small and fast, for checking composition.

    Restores the scene's render settings afterwards so a preview never leaves
    the .blend configured at preview quality — which is otherwise an easy way
    to spend an hour rendering a noisy final.
    """
    previous = (
        scene.cycles.samples,
        scene.render.resolution_percentage,
        scene.render.filepath,
        scene.frame_current,
    )

    path.parent.mkdir(parents=True, exist_ok=True)
    scene.cycles.samples = samples
    scene.render.resolution_percentage = max(1, int(scale * 100))
    scene.render.filepath = str(path.with_suffix(""))
    scene.frame_set(frame)
    bpy.ops.render.render(write_still=True)

    (
        scene.cycles.samples,
        scene.render.resolution_percentage,
        scene.render.filepath,
        _,
    ) = previous
    scene.frame_set(previous[3])
    return path


def configure_sequence(scene: bpy.types.Scene, directory: Path) -> None:
    """Set up a PNG image-sequence render of the loop.

    A frame sequence rather than a direct video encode, always. A crashed or
    interrupted video render leaves an unusable file; a sequence leaves every
    frame it finished, so the render resumes instead of restarting. The encode
    is a separate, cheap, repeatable step — see `ffmpeg_command`.
    """
    directory.mkdir(parents=True, exist_ok=True)
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15
    scene.render.filepath = str(directory / "frame_")


def ffmpeg_command(
    directory: Path,
    output: Path,
    fps: int,
    frames: int,
    crf: int = 16,
) -> str:
    """The encode command for a seamlessly looping H.264 wallpaper.

    `-g` pins the GOP to the loop length so the wrap always lands on a
    keyframe. `yuv420p` is not optional — it is what makes the file playable
    by the hardware decoders in Wallpaper Engine, Lively and Android, all of
    which will simply refuse a 4:4:4 file.
    """
    return (
        f"ffmpeg -y -framerate {fps} "
        f"-i {directory / 'frame_%04d.png'} "
        f"-c:v libx264 -preset slow -crf {crf} "
        f"-pix_fmt yuv420p -g {frames} -keyint_min {frames} -sc_threshold 0 "
        f"-movflags +faststart "
        f"{output}"
    )
