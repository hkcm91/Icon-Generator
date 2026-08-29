# 3D aquarium — sourcing assets we are allowed to sell

Where the fish, coral, substrate and tank come from for a paid aquarium live
wallpaper, and which licences survive the way a live wallpaper is actually
shipped. The shortlist is at the end; the constraint that produces it comes
first, because it eliminates most of the obvious answers.

## The constraint that decides everything

An Android live wallpaper ships as an APK. An APK is a zip. A `.glb` sitting
in `assets/` is retrieved by renaming the file and double-clicking it — no
tooling, no skill, about four seconds.

Every mainstream marketplace licence permits selling the *app* and forbids
shipping the *model* in a form a third party can retrieve on its own. The
wording differs; the line does not:

| Marketplace | The clause |
| --- | --- |
| [TurboSquid Royalty Free](https://www.turbosquid.com/licensing) | Games and apps are permitted uses; redistribution is allowed only where the files are "part of a larger creation and not in an open format" others can download. |
| [Fab Standard](https://www.fab.com/eula?lang=en) | Content may not be distributed "on a standalone basis to third parties"; it must be incorporated into a project, not extractable from it. |
| [Unity Asset Store EULA](https://unity.com/legal/as-terms) | Assets may not be redistributed standalone or in a way that lets others extract them from the final product. |
| [CGTrader Royalty Free](https://help.cgtrader.com/hc/en-us/articles/360015124437-Royalty-Free-License) | Usable "as long as it is incorporated into the product and as long as the 3rd party cannot retrieve it on its own". |
| [Sketchfab Store / standard](https://sketchfab.com/licenses) | You may not use the asset in a way that allows others to access it "as a stand-alone file". |

A Unity or Unreal game satisfies this incidentally: meshes go into asset
bundles or `.pak` files, and pulling them out takes AssetRipper and intent.
A WebGL wallpaper of the kind this repo already builds — an HTML page and a
folder of glTF, wrapped in a `WallpaperService` — does not satisfy it at all.
Our delivery format is the licence problem.

That leaves three routes, and they can be mixed per asset:

1. **Public-domain assets.** CC0 carries no redistribution restriction, so
   extractability is irrelevant. Cheapest, fastest, and the only route where
   the shipping format needs no thought.
2. **Marketplace assets plus a packing step** that makes the mesh
   non-retrievable — a custom binary container rather than loose `.glb`.
   Buys higher-fidelity models at the cost of a build step and a judgement
   call about what "cannot retrieve on its own" means.
3. **Assets we own** — procedurally generated or commissioned work-for-hire.
   No licence surface at all, and the only route that survives a competitor
   filing a takedown out of spite.

## Tier 1 — public domain (recommended for v1)

No attribution, no restriction on extraction, no per-title fee.

| Source | Licence | What it covers | Notes |
| --- | --- | --- | --- |
| [Quaternius](https://quaternius.com/) ([itch](https://quaternius.itch.io/lowpoly-animated-fish)) | CC0 | **Animated Fish Pack**, **Animated Cute Fish Pack**, nature/plant packs | Each fish is rigged with a swim animation, in FBX/OBJ/BLEND. This is the single highest-value source for this project: rigged and animated CC0 fish are otherwise near-impossible to find. |
| [Poly Pizza](https://poly.pizza/u/Quaternius) | CC0 and CC-BY, filterable | The Google Poly successor; hosts the Quaternius [Animated Fish Bundle](https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g) (7 models, FBX/OBJ/glTF) plus loose reef props | Serves glTF directly, so no conversion step. Filter to CC0; CC-BY entries are fine but incur a credits screen. |
| [ambientCG](https://ambientcg.com/) | CC0 | PBR substrate: sand, gravel, wet rock, glass, algae | 2000+ materials. Everything the tank floor and the rockwork needs. |
| [Poly Haven](https://polyhaven.com/license) | CC0 | HDRIs for the room light outside the glass, plus textures | Explicitly: any purpose, commercial included, no credit required. |
| [Smithsonian Open Access](https://3d.si.edu/corals) | CC0 | 90+ photogrammetry-scanned coral type specimens | Real scans — museum-accurate silhouettes at millions of triangles. Budget an afternoon of decimation and retopology per piece. Take them from `3d.si.edu`, not Sketchfab (see below). |
| [Kenney](https://kenney.nl/) | CC0 | Stylised props and a nature kit | Useful if the art direction goes toy-like rather than realistic. |

**Do not route through Sketchfab.** Epic stopped offering downloadable content
there during 2025 while folding the Store into Fab, and the migration
explicitly excluded CC0, CC-BY-SA, CC-BY-NC and CC-BY-ND models — so the
museum collections that live there are the ones that did *not* come across.
Where a Smithsonian model exists on both, take the `3d.si.edu` copy.

**Treat AI-generation sites as unresolved.** Meshy and similar advertise CC0
on generated meshes, but the licence you care about is the one covering their
training data, and that is unsettled. Fine for greyboxing the scene; not
something to ship in a paid app while cheaper certainty exists.

## Tier 2 — paid marketplace assets

Worth it when the CC0 fish look too plain to sell against the incumbents.
Representative of what is out there and what it costs:

- [Voxel Fish Pack](https://www.fab.com/listings/7240cbe8-2bf0-4476-9d5c-57c396c75e16?lang=en) (Fab) — 20 animated fish, tropical through deep-sea, with two animation sets per model.
- [Aquarium Fish 7](https://assetstore.unity.com/3d/characters/animals/fish) (Unity Asset Store) — ~$29, 7 species, 22 animation clips each, including feeding states.
- [Aquarium fish — large pack](https://assetstore.unity.com/packages/package/id/aquarium-fish-large-pack-370786) (Mixall, Unity Asset Store) and the [Animated Fish Tank](https://assetstore.unity.com/packages/3d/props/interior/animated-fish-tank-131618) prop set.
- TurboSquid and CGTrader carry photoreal reef species individually, typically $15–80 a fish.

Two costs beyond the sticker price. Unity Asset Store packs arrive as
`.unitypackage` and need extracting and converting to glTF before this
pipeline can read them — and the same EULA that forbids extraction from your
build governs that conversion, so the converted file is as restricted as the
original. And every one of them obliges the packing step below.

### If you ship paid assets: what packing has to do

The licences ask that a third party "cannot retrieve it on its own". That is a
deterrence standard, not a DRM standard — nobody expects a wallpaper to defeat
a determined reverse engineer. Concretely, it means:

- No loose `.glb`, `.fbx` or `.obj` in `assets/`. Concatenate the meshes into
  one binary container with a project-specific header, interleaved buffers and
  a cheap stream transform (compress, then XOR with a key derived from the
  header). Loading that costs one `ArrayBuffer` walk in the wallpaper.
- No source textures at native path names — atlas them.
- Keep the unpacked originals out of the repo and out of the APK; build the
  container from a local, gitignored `vendor/` directory.

Everything in Tier 1 is exempt: CC0 has no such clause, and shipping plain
glTF is a legitimate choice for it.

## Tier 3 — assets we own outright

This repo already demonstrates the cheap version of this. `blender/liquid_shaker.py`
builds an entire scene — geometry, materials, particles, lighting, camera,
animation — from CLI flags, with nothing hand-placed. The same approach covers
most of an aquarium without touching a marketplace:

- **Tank, glass, bezel, water volume, surface** — parametric geometry. The
  shaker wallpaper already refracts a rim and simulates a fluid; an aquarium
  is the same problem with a bigger box.
- **Caustics** — generate in the shader from two scrolling Voronoi layers, or
  bake a seamless loop in Blender. Nobody should be licensing a caustics
  texture; it is a dozen lines of GLSL and it animates properly.
- **Bubbles, silt, light shafts** — particles, as in the existing wallpaper.
- **Plants** — Blender geometry nodes, driven by a bend field so they sway
  with the same flow that carries the fish.

That leaves the fish themselves, which are the one genuinely hard thing to
generate procedurally and the one thing Quaternius gives away. Commissioning
a rigged, animated species costs roughly $150–400 work-for-hire; worth it for
two or three hero fish once the wallpaper sells, not before. **Get an
assignment of copyright in writing**, not a licence — otherwise Tier 3 quietly
becomes Tier 2.

## Recommendation

Ship v1 as CC0 plus procedural, and keep the paid route open behind the
packing step:

| Slot | Take it from |
| --- | --- |
| Fish (6–10 species, rigged, animated) | Quaternius Animated Fish + Cute Fish, CC0 |
| Coral, rockwork | Smithsonian scans, decimated — or procedural, CC0 |
| Plants | Blender geometry nodes, owned |
| Substrate, glass, algae materials | ambientCG, CC0 |
| Room light through the glass | Poly Haven HDRI, CC0 |
| Water, caustics, god rays, bubbles | Shader and particles, owned |
| Tank, bezel, refraction | Parametric, owned — the shaker's rim already does this |

Nothing on that list requires attribution, a per-title fee, an extraction
audit, or a conversation with a marketplace's legal team. The whole v1 asset
bill is zero, and every asset stays legal in the format the wallpaper wants to
ship it in.

Add a credits screen anyway if any CC-BY asset creeps in — CC-BY needs title,
author, licence and a link, reachable from the wallpaper's settings activity.
The tooling below will tell you when you have crossed that line.

## What is in the repo

- [`aquarium/assets.manifest.json`](../aquarium/assets.manifest.json) — every
  asset slot, its source, author, licence and expected files. `distribution`
  at the top records how we ship (`extractable` for loose glTF in an APK,
  `packed` once a packing step exists); the licence policy reads it.
- [`scripts/aquarium-assets.mjs`](../scripts/aquarium-assets.mjs) — checks the
  manifest against that policy, refuses licences that cannot survive our
  delivery format, locks acquired files by SHA-256, and generates the
  attribution file. `node scripts/aquarium-assets.mjs check`.
- [`aquarium/README.md`](../aquarium/README.md) — the acquisition workflow.

The check is the part worth keeping. Licence compliance decays the moment
someone drops a promising `.glb` into the assets folder at midnight; a script
that fails the build is a better guard than this document.

## Sources

- [TurboSquid 3D Model License](https://www.turbosquid.com/licensing) and [Using the TurboSquid Royalty Free License](https://blog.turbosquid.com/royalty-free-license/)
- [Fab Standard License](https://www.fab.com/eula?lang=en)
- [Unity Asset Store Terms of Service and EULA](https://unity.com/legal/as-terms)
- [CGTrader Royalty Free License](https://help.cgtrader.com/hc/en-us/articles/360015124437-Royalty-Free-License)
- [Sketchfab License Agreement](https://sketchfab.com/licenses)
- [Poly Haven license](https://polyhaven.com/license) · [ambientCG license](https://docs.ambientcg.com/license/)
- [Smithsonian Open Access FAQ](https://www.si.edu/openaccess/faq) · [Smithsonian coral collection](https://3d.si.edu/corals)
- [Quaternius — LowPoly Animated Fish](https://quaternius.itch.io/lowpoly-animated-fish) · [Animated Fish Bundle on Poly Pizza](https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g)
- [Epic phases out Sketchfab downloads for Fab](https://www.fabbaloo.com/news/epic-games-phases-out-sketchfab-in-2025-launches-unified-fab-marketplace)
- [Understanding 3D asset licenses for games and commercial projects](https://3dskillup.art/3d-asset-licenses-for-games/)

This is engineering research, not legal advice. The clauses are quoted from
the licences as published; if the app becomes worth suing over, have a lawyer
read the two or three that actually end up in the build.
