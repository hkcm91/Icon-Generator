# 3D aquarium — asset acquisition

The asset side of the aquarium wallpaper: where each piece comes from, what it
is licensed under, and a check that refuses licences our delivery format cannot
honour. The sourcing research and the reasoning behind the policy are in
[`docs/AQUARIUM-ASSETS.md`](../docs/AQUARIUM-ASSETS.md).

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
