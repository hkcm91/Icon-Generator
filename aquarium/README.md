# 3D aquarium — particle fish, and asset acquisition

## The prototype

[`prototype.html`](prototype.html) is a working answer to "can the fish be
particles instead of models?". Open it in a browser — one self-contained file,
no build step, no dependencies, **and no assets at all**.

![Particle fish at the frame budget](../docs/screenshots/aquarium-particle-fish.png)

A fish here is a few dozen points sampled from a parametric side profile, bent
by a travelling wave and drawn as additive sprites. There is no mesh and no
rig, so there is nothing to license — the constraint that shapes
[docs/AQUARIUM-ASSETS.md](../docs/AQUARIUM-ASSETS.md) simply does not apply to
a fish that is generated on the device.

```bash
open aquarium/prototype.html                       # or serve the folder
open 'aquarium/prototype.html?pose=1&fish=4'       # look-dev: hold them still
npm run aquarium:shot                              # re-render docs/screenshots
```

Flags: `fish`, `points`, `motes`, `seed`, `speed`, `hud`, `pose`. `pose=1`
parks one of each species in a column so proportion and fin shape can be judged
without waiting for a fish to swim past — the same reason `--static` exists in
`blender/liquid_shaker.py`.

![Each species held still for look-dev](../docs/screenshots/aquarium-fish-detail.png)

### What it settled

- **Point count has to follow fish size, not be a constant.** A flat 80 points
  spread across a hero-sized body reads as a scatter of orbs, not an animal.
  `points` is now a budget for a reference length and scales from there.
- **An outline alone reads as a ring.** Sampling only the silhouette made the
  tall species look like jellyfish. A bright lateral line down the body — a
  tenth of the budget — states which end is the head before the eye is even
  legible.
- **One bright eye is worth twenty body points.** It is the strongest "this is
  an animal" cue in the cloud.
- **Light shafts have to be sprites, not polygons.** A polygon edge stays
  visible however low you push the alpha; the first draft read as hard stripes.

### What it costs

At the default 12 fish the HUD (`?hud=1`) reports **~1,270 points and ~1,150
sprite draws per frame** — in the same range as the shaker's existing ~950
particles, which is the budget this was designed against. The frame rate in
that HUD comes from headless Chromium on a desktop container, so treat it as
confirmation that the *draw count* is what was predicted, **not** as a phone
measurement. Only the APK on a handset settles that.

### What a bought mesh cannot do

Tapping a fish bursts it into points that the water carries off before they
reassemble. The fish live in the same flow field as the motes, so this is a
few lines rather than a feature.

![A school mid-burst, dissolved into the water](../docs/screenshots/aquarium-burst.png)

## Asset acquisition

Where each remaining piece comes from, what it is licensed under, and a check
that refuses licences our delivery format cannot honour. The sourcing research
and the reasoning behind the policy are in
[`docs/AQUARIUM-ASSETS.md`](../docs/AQUARIUM-ASSETS.md). The prototype above
removes the fish from this list; coral, materials and lighting still need it.

Short version: a live wallpaper ships as an APK, an APK is a zip, and a loose
`.glb` inside one is retrieved by renaming the file. Marketplace royalty-free
licences forbid exactly that, so v1 is sourced entirely from public-domain and
procedural assets — Quaternius for rigged animated fish, Smithsonian scans for
coral, ambientCG and Poly Haven for materials and light, and this project's own
Blender pipeline for the tank, water, plants and caustics.

## Acquiring

Downloaded assets are deliberately **not committed** — they are large, they are
re-acquirable from the manifest, and keeping them out means a paid asset can
never be pushed to a public repo by accident.

```bash
node scripts/aquarium-assets.mjs check     # what is missing, and what its licence permits
# download each listed source into aquarium/assets/<path from the manifest>
node scripts/aquarium-assets.mjs lock      # SHA-256 every acquired file
node scripts/aquarium-assets.mjs attrib    # regenerate THIRD-PARTY-LICENSES.md
```

`check` exits non-zero on a licence violation, an unrecognised licence, or a
manifest entry missing its source — so it belongs in CI ahead of any APK build.
`lock` reports files that changed or disappeared since the last run, which is
how a silently swapped mesh gets noticed.

## Adding an asset

Add an entry to [`assets.manifest.json`](assets.manifest.json) with its `id`,
`role`, `title`, `author`, `license`, source `page` and expected `files`, then
run `check`. An unfamiliar licence string returns `review` rather than passing;
that is the point. Encode a new one in `scripts/aquarium-assets.mjs` only after
reading the actual terms.

## Shipping paid assets later

Set `"distribution": "packed"` in the manifest once meshes are built into a
container a user cannot open by renaming it. That single flag switches
marketplace royalty-free licences from blocked to permitted, and `check` will
then hold you to crediting them. Do not set it before the packing step exists —
it is the only thing standing between a purchase and a licence breach.
