# The aqua live wallpaper

The icon set exists. This is the scene it lives in.

Nothing here is decided yet. This is the shortlist, the constraints that
generated it, and what each option would cost. The rig that all of them need is
already built and rendering — see [`blender/README.md`](../blender/README.md).

## The trap, first

The obvious move is to make a Frutiger Aero wallpaper. The obvious move is
wrong, and it is worth being precise about why, because it decides most of what
follows.

The icons are bright aqua glass with white glyphs. A bright aqua-and-white
wallpaper puts them on a background of their own colour at their own value, and
they stop being objects — they become texture. Every genuinely good icon-pack
wallpaper solves this the same way: it is the *same world* as the icons, seen
from a place where it is darker and softer. Same palette, different exposure.

So the working rule for every concept below:

- **Dark and quiet through the middle band**, where the icon grid sits.
- **Bright at the top**, behind the clock, where there is nothing to compete
  with and where the eye wants an anchor.
- **All the detail out of focus.** Anything sharp behind a sharp icon reads as
  dirt on the screen.
- **Slow.** Roughly a tenth of a screen-height per second is the ceiling for
  anything in the icon region. Faster than that and it is not a wallpaper, it
  is a distraction you cannot dismiss.

There is a second argument that points the same way: on an AMOLED panel a dark
wallpaper costs meaningfully less battery than a bright one, because black
pixels are switched off rather than dimmed. Legibility and battery want the
same thing, which is rare enough to take seriously.

## The five candidates

### A. Deep Field — submerged, looking up

The screen is a column of water. The top is the surface seen from below:
bright, rippling, a sun disc smeared through it, god rays raking down. The
bottom falls away into blue-black. The icon grid sits in the calm dark middle;
the clock sits against the bright surface.

*Moves:* god rays sway, surface ripples, bubbles rise and vanish at the
surface, a slow bokeh field drifts.

*Why it is the front-runner:* the value gradient is correct for free. It is not
a compromise imposed on the composition — bright-at-top, dark-at-bottom is what
being underwater actually looks like. Every other concept has to be talked into
the right value structure. This one starts there.

*Cost:* volumetrics for the god rays are the expensive part. On EEVEE, minutes
for the loop. On CPU Cycles, not viable.

### B. Icon Reef — the wallpaper is made of the icons

A field of the same glass tiles, standing in shallow water and receding into
fog. The visible ones are all mid-ground and background, so heavily defocused
that they read as coloured light rather than as shapes. The icons on the home
screen become the front row of the same species.

*Moves:* a slow camera dolly for parallax, tiles bobbing on offset phases, a
light sweep travelling along their rims.

*Why it is tempting:* it is the only concept that could not be made for any
other icon pack. The tile builder is already written, so most of the work is
composition rather than new machinery.

*Risk, and it is real:* squircles behind squircles is camouflage in its purest
form. It survives only if the background tiles never resolve as tiles — deep
defocus, low contrast, never the same size or spacing as the real grid. That is
a narrow window and it needs to be tested early with actual icons on top.

### C. Bliss 2.0 — the grass horizon

The canonical one. Green field, blue sky, cumulus, a lens flare, macro grass
along the bottom edge, dandelion bokeh drifting up.

*Moves:* clouds drift, grass sways, the flare breathes.

*Why:* it is the single most recognisable image in the aesthetic. Nothing else
on this list produces the same immediate hit.

*Against:* the brightest possible option, which is exactly wrong behind bright
icons, and worst-case for battery. Rescuing it means dropping the horizon low,
darkening the sky toward the top, and accepting that the good part — the field
— lives in the bottom fifth behind the dock. That is a lot of work to end up
with a mostly-empty sky.

### D. Aero Ribbon — the Vista one

A slow-rotating band of dispersive glass in near-black teal. Bokeh, a light
sweep, no nature at all.

*Why:* darkest, cheapest, fastest to render, and it cannot fight the icons
because there is nothing in it to fight with. The most robust option by a
distance.

*Against:* it is Windows Aero rather than Frutiger Aero. No water, no life, no
sky. It answers the brief with the half that has aged best and skips the half
that people actually miss.

### E. Ripple Well — interactive

Still water seen from above. Touch and scroll push ripples across it; the icons
cast refracted shadows onto the surface below them.

*Why:* the icons stop sitting *on* the wallpaper and start being *in* it. It is
the only concept where the wallpaper knows the icons exist.

*Against:* it is not a video, so Blender stops being the renderer and becomes
the authoring tool — geometry and materials get exported and the actual ripples
run in a shader. Different pipeline, different delivery targets, several times
the work. Worth keeping on the list precisely because it is the one with a
ceiling above the others.

## The recommendation

**A, with B's tiles as its far field.**

Deep Field gives the value structure. Then the drifting bokeh in the middle
distance is not abstract — it is icon tiles from the set, far enough back and
far enough out of focus to be colour rather than shape, rising slowly through
the water. They are unreadable as icons and unmistakably the same material.

That is one scene rather than two, it keeps the thing that makes B special
without the camouflage risk that sinks it, and it uses the tile builder that
already exists.

## Getting it onto a screen

| Route | Takes | Notes |
| --- | --- | --- |
| Android, video wallpaper | MP4 loop | Widest support. Playback pauses with the screen off, so idle cost is nil. |
| Android, KLWP | layered assets | More control, more setup, and it re-authors the scene in someone else's tool. |
| Windows, Wallpaper Engine | MP4, or HTML5/shader | Hardware-accelerated, seamless looping. The interactive route lives here too. |
| Windows, Lively | MP4, GIF, HTML5, shader | Free and open source, same format range. |

The video routes all want the same file, which is the argument for rendering
one master loop and cutting it per target rather than building per platform.

Sizes are in `blender/aero/render.py`: `phone` is 1440×3120, `phone-1080` is
1080×2400, `desktop` is 3840×2160. `phone-pan` is double-width for launchers
that slide the wallpaper between home screens — worth rendering only if the
launcher in question actually does that, since it doubles the pixels.

Ten seconds at 30fps is the working default. Long enough that the loop is not
obvious, short enough to render and to ship.

## Open decisions

1. **Which concept**, or which combination.
2. **Phone, desktop, or both.** It changes the composition, not just the
   resolution: a 16:9 desktop frame has no dead middle band to hide the icon
   grid in.
3. **Video or interactive.** Video is one pipeline ending in an MP4.
   Interactive is a second pipeline and roughly the same work again, and it is
   only worth it for concept E.

## Sources

- [Frutiger Aero — Aesthetics Wiki](https://aesthetics.fandom.com/wiki/Frutiger_Aero)
- [Frutiger Aero Archive](https://frutigeraeroarchive.org/)
- [Lively Wallpaper — supported wallpaper types](https://livelywallpaper.io/wallpaper-types/)
- [Wallpaper Engine — seamless loops](https://infinitylooper.com/wallpaper-engine)
- [Live wallpapers and battery on Android](https://thebatterytips.com/battery-specifications/do-live-wallpapers-take-up-battery/)
- [Best live wallpaper apps for Android](https://blog.zedge.net/best-live-wallpaper-apps-for-android/)
- [Recreating a realistic underwater scene in Blender (EEVEE)](https://medium.com/@kretoskim/recreating-a-realistic-underwater-scene-in-blender-eevee-eec6c9c0c0bb)
- [Refractive caustics with Geometry Nodes](https://80.lv/articles/refractive-caustics-made-with-blender-s-geometry-nodes)
