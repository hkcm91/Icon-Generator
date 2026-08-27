# Frutiger Aero live wallpaper — concepts and research

> **Decided: Aquarium Dock, 16:9 desktop, 9 icons, delivered as a
> pre-rendered video loop.** Build it with `python build.py --scene aquarium`
> — those are the defaults. The rest of this document is kept as the record of
> why, and as the menu if a second wallpaper is ever wanted.

This was the menu and the constraints, written down so the choice could be
made on evidence rather than vibes. The pipeline is built to serve any of the
six concepts below; picking one is a scene module, not a rewrite.

---

## 1. What the aesthetic actually requires

Worth being precise about, because "Frutiger Aero" is usually described by
listing motifs, and a list of motifs is not something you can build from.

The [Aesthetics Wiki](https://aesthetics.fandom.com/wiki/Frutiger_Aero) and the
[University of Waterloo Computer Museum's
exhibit](https://uwaterloo.ca/computer-museum/exhibits/frutiger-aero-future-2000s)
both date the style to roughly 2004–2013 and name the same recurring elements:
glossy and glass-like surfaces, skeuomorphism, cloudy skies, tropical water,
bubbles, lens flares, auroras, bokeh, lush green, and a white/green/blue
palette. The Waterloo exhibit adds the thing that actually explains the style:
it was selling a **utopian vision of technology in harmony with nature** —
which is why the imagery is always both synthetic and organic at once, and why
it never looks grimy or worn.

Translating that into things a renderer can do, there are three claims every
surface makes, and they matter more than the motif checklist:

| Claim | In practice | If you skip it |
|---|---|---|
| Everything is wet | A hard clear coat over a softer coloured body | Reads as matte plastic |
| Light passes through things | Transmission on glass, subsurface on gel | Flat, dead, sticker-like |
| Thin films are everywhere | Soap-bubble iridescence at grazing angles | Loses the period entirely |

`fa/materials.py` is written directly against these three, which is why its
materials are all two-layer rather than one glossy layer.

There is also a lighting signature the motif lists miss: **you can see the
light itself.** Sun behind and above, sky bright enough that nothing is ever
truly dark, and enough haze that beams are visible. It was a wallpaper
aesthetic in the literal sense — designed to look good with icons on top of it.

**Where the generated icons already help.** The current family is painted as
wet aqua glass with internal bubbles and highlights. That is enormously
useful: the artwork already satisfies claims 1–3 in 2D. The scene's job is not
to add gloss, it is to *avoid contradicting* what is already painted. Which is
the single strongest argument for a water concept — put those icons anywhere
dry and the artwork and the environment disagree about what material the icon
is made of.

---

## 2. Six concepts

Ranked by how well they use *these specific icons*, not by how pretty the
still would be.

### 1. Aquarium Dock — **chosen**, see `fa/scenes/aquarium.py`

Icons hang suspended in still, sunlit water. Caustics crawl across their
faces, bubbles rise past them, light shafts fall from the surface overhead.

- **Why it works:** the painted highlights become literal. Zero conflict
  between artwork and environment.
- **Risk:** volumetrics plus transmission is the most expensive combination in
  the project. The render budget in §4 is the real constraint.
- **Best for:** desktop, 16:9 and ultrawide.

Built out and shipped. What changed from the first pass, all of it findable in
the git history: the caustic projector became a spot rather than an area light
(a wide source cannot cast a sharp gobo), scattering and absorption were given
separate densities (one density forces a choice between colourless and foggy),
the camera was moved below the tiles to look up into the light, and the
bubbles were re-shaded as films rather than beads of glass.

The aurora is not in the final scene. Below the waterline the background has
to *start* dark for anything to have contrast against it, which leaves no
bright sky to put an aurora in. It stays available in
`environment.build_world(aurora=True)` for whichever concept is shot in air.

### 2. Bubble Column

A vertical column of rising bubbles, each large bubble carrying one icon
refracted inside it. Loops by respawning at the bottom.

- **Why it works:** portrait by construction, so it is the phone answer. Puts
  the single most period-correct motif — the soap bubble — at the centre
  instead of in the background. Refraction reveals the icon gradually as the
  bubble turns, which is genuinely novel.
- **Risk:** an icon seen through a refractive shell is *distorted*, and app
  icons are supposed to be recognisable. Probably needs the icon as a flat
  card just inside the bubble rather than truly refracted through it.
- **Effort:** medium. Reuses the existing loop, glass and tile code almost
  entirely.
- **Best for:** phone.

### 3. Aero Shelf

A curved frosted-glass panel floating over an aurora, icons docked on it in a
grid, parallax on mouse or gyro.

- **Why it works:** by far the most *usable*. Icons stay legible, aligned, and
  out of the way of desktop shortcuts. The Windows Aero panel is the single
  most on-the-nose reference available.
- **Risk:** the most likely to end up looking like a corporate stock render.
  Lives or dies on the aurora and the parallax.
- **Effort:** low — a frosted material already exists, and a grid is easier
  than an arc.
- **Best for:** desktop, and the obvious pick if the wallpaper has to coexist
  with actual icons on top.

### 4. Bliss Hill

The XP hill, reinterpreted: lush grass, hyper-blue sky, god rays, lens flare,
icons as glossy pebbles half-set into the slope.

- **Why it works:** the most instantly recognisable, most joyful option. The
  nature half of the aesthetic, which the water concepts mostly skip.
- **Risk:** grass is expensive and hard, and the icons compete with a busy
  background rather than sitting in it. It is also the one concept where the
  wet-glass artwork actively fights the environment.
- **Effort:** high. Grass geometry is a project of its own.
- **Best for:** desktop, if we want the wallpaper to be a *place*.

### 5. Dew Terrarium

Macro shot: dewdrops on grass blades, each drop refracting an icon. Heavy
bokeh.

- **Why it works:** the most tactile and the most original. Macro scale means
  a small number of hero icons rather than a family, which suits a wallpaper.
- **Risk:** only fits 3–5 icons. If the point is to showcase a whole generated
  family, this is the wrong shape.
- **Effort:** medium-high.
- **Best for:** phone, or a showcase still.

### 6. Aero Orbit

Icons orbit a glowing glass sphere like a slow carousel.

- **Why it works:** the loop is *free* — one full rotation is exactly periodic
  with no fades or tricks. Cheapest to render, scales to any icon count,
  hardest to get wrong.
- **Risk:** the least interesting. Reads as a screensaver.
- **Effort:** lowest. A day.
- **Best for:** a safe fallback, or a stress test of a large family.

---

## 3. Getting it onto a screen

Research on delivery, because it constrains the scene more than the scene
constrains it.

### Two fundamentally different outputs

**Pre-rendered video loop.** Blender renders the frames, ffmpeg encodes them,
the player loops the file.

- Works in [Lively Wallpaper](https://livelywallpaper.io/wallpaper-types/),
  which supports MP4 (H.264 and H.265), WebM, MOV and others with hardware
  decode, and in Wallpaper Engine. Android plays video wallpapers too.
- Full Cycles quality — real caustics, real volumetrics, real depth of field.
  Nothing is faked down to what a GPU can do at 60fps.
- Cannot react to anything. No parallax, no gyro, no time of day, no audio.
- Lively pauses playback under fullscreen apps and drops the frame rate when
  the desktop is hidden, so the runtime cost is lower than it sounds.

**Real-time WebGL.** Blender is authoring only; the scene exports to glTF and
runs in Three.js.

- Runs as an HTML wallpaper in both Lively and Wallpaper Engine. Wallpaper
  Engine's web type explicitly supports Three.js and WebGL, and exposes audio
  data to the page when `supportsaudioprocessing` is set in `project.json`.
- Interactive: parallax, gyro, clock, audio reactivity all become possible.
- **Materials do not survive the trip.** This is the main finding and it is
  consistent across the [three.js
  forum](https://discourse.threejs.org/t/mirror-and-glass-in-blender-with-three-js-export/5418)
  and [model-viewer
  discussions](https://github.com/google/model-viewer/discussions/4620):
  glass and transmission export unreliably from Blender and generally have to
  be re-authored in code, typically with `MeshPhysicalMaterial` or drei's
  `MeshTransmissionMaterial`. Since this entire aesthetic *is* glass, that
  means the shading work would be done twice, in two languages.

### On Android specifically

Worth knowing before anyone commits to a phone target: a live wallpaper holds
a `PARTIAL_WAKE_LOCK`, and measurements circulating for Snapdragon 8 Gen 2 put
the idle power increase around 25%. Real-world impact is usually a few percent
of daily battery, and the standard mitigations — pause rendering when not
visible, drop the frame rate — are effective. Interactive wallpapers that poll
the gyroscope cost the most. A paused video loop is the cheapest option
available.

### Recommendation

**Start with the video loop.** It gets the full render quality that this
aesthetic depends on, works on every target platform from one file, and needs
no second implementation of the materials. Treat Three.js as a later port for
whichever concept turns out to want interactivity — realistically only the
Aero Shelf, whose parallax is the point.

One caveat worth flagging now rather than later: the encode settings are not
cosmetic. Rendering `L+1` frames, or letting the keyframe interval drift out
of sync with the loop length, produces a visible hitch once per loop even when
the animation itself is perfect. `fa/render.py::ffmpeg_command` encodes those
rules; §4 of the README explains them.

---

## 4. Decisions taken

1. **Concept:** Aquarium Dock.
2. **Target:** 16:9 desktop, 2560×1440, delivered as an MP4 loop.
3. **Icon count:** 9, laid on a shallow arc rather than a grid. The arc gives
   every tile a slightly different angle to the key light, so the specular
   highlight walks along the row instead of appearing on all nine at once —
   the difference between a rendered image and a contact sheet.
4. **Interactivity:** none, so the video-loop path holds and the materials are
   implemented once.

Still open, and cheap to change later:

- **Loop length.** 300 frames / 10s is the default. Longer costs render time
  linearly and makes the repetition less noticeable; `--frames` is the only
  change needed and the loop verifier covers any value.
- **A phone cut.** Would be a sibling scene module, not a crop — a 16:9 arc of
  nine tiles has nothing to show in 9:19.5. The Bubble Column concept was
  designed for that shape.
