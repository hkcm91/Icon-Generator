# Icon Generator

Geometry is compiled. Material is generated. The two never negotiate.

A React app for producing icon families where the container shape is a
**declarative spec** rather than something an image model draws. The model
supplies surface texture and glyphs; code supplies every edge. This removes
corner-radius drift by construction rather than by tuning.

Carried over from `EtsyIconAndWidgetShop/tools/icon-family-studio`: the
Replicate integration, the model presets, the family/container concept and the
background-keying approach. Rebuilt: the geometry pipeline.

## Why

The previous pipeline sent geometry to the model as prose —
`radius 30%; padding 8%; shape squircle` — and a diffusion model has no
mechanism to honour a number. The silhouette was re-decided on every run.
Full diagnosis, including the two other contributing causes and a bug where the
radius slider had no effect in squircle mode:
**[docs/RADIUS-DRIFT.md](docs/RADIUS-DRIFT.md)**.

Where this sits relative to the existing tools, and the gap it takes:
**[docs/MARKET-RESEARCH.md](docs/MARKET-RESEARCH.md)**.

## Quick start

```bash
npm install
cp .env.example .env      # add your Replicate token (r8_...)
npm run dev               # web on :5173, proxy on :8787
```

The token stays server-side. The browser never receives it.

Without a token everything except generation still works — spec editing,
preview, determinism check, and all exports.

## How it works

```
ContainerSpec (JSON)  ──►  exact SVG path  ──┐
                                              ├──►  clip  ──►  composite  ──►  icon
Replicate ──► material (full-bleed texture) ──┤
Replicate ──► glyph (chroma field, keyed)   ──┘
```

The model is never told the shape *as text*. No radius, no padding percentage,
no container word — those are the numbers it cannot honour. Open **Prompts
actually sent** in the app to see exactly what goes over the wire.

### Shape conditioning

It can, however, be *shown* the shape. Three modes, all ending in the same clip:

| Mode | What the model gets | Trade-off |
|---|---|---|
| **Clip only** | Nothing — a free texture, cut to shape afterwards | Works with any model; body can read flat, since the lighting doesn't know where the corners are |
| **Shape reference** | A base plate rendered from the spec, as an image input | Shading follows the real contour; needs an editing model |
| **Masked fill** | Base plate **+** a mask, white inside the container | Strongest; needs an inpainting model (`flux-fill-dev` is wired up) |

The clip runs in every mode, so the outline is exact whatever the model returns.
Conditioning changes how good the *material* looks, not whether the geometry
holds. Details in [docs/RADIUS-DRIFT.md](docs/RADIUS-DRIFT.md).

### Shapes

| Kind | Definition |
|---|---|
| `superellipse` | `\|x/a\|ⁿ + \|y/b\|ⁿ = 1`. `n=2` ellipse, `n=4` Lamé squircle, `n=5` ≈ Apple's icon mask, higher = squarer |
| `rounded-rect` | Exact circular-arc corners. `radius: 25` on a 1000px box is 250px |
| `circle` | Exact |
| `custom-path` | Any SVG path authored in a 0–1000 viewBox |

### Proving it, rather than claiming it

**Determinism check** re-renders the icon 10 or 50 times and hashes each frame's
raw RGBA. Identical hashes or it isn't fixed. **Drift comparison** shows six
spec-compiled renders against six with simulated prompted-geometry jitter.

**Measure imported PNGs** does the same job against your *real* output. Drop in
a batch of previously generated containers and it reports, per file, the corner
radius in px and as a percentage, the best-fit superellipse exponent, and
whether the silhouette is genuinely a rounded rect or a continuous-curvature
squircle — plus the spread across the batch, which is the drift, measured.

Accuracy, validated by round-tripping against analytically rasterised shapes
with known geometry: **radius within 0.13px** across 20–200px radii, and
**exponent within 0.03%** across n = 2–10.

Each row has a **Use** button that writes that file's measured geometry into the
spec. The container you already liked becomes the one you get every time.

Images that arrive fully opaque — which is most model output, whatever the
prompt asked for — are keyed against the flat background before measuring, and
flagged as `keyed` in the table.

## Exports

Every size is a **fresh render from the path**, not a downscale of one master —
so a 16px corner is antialiased for 16px instead of resampled from 1024px.

- iOS, Android (mdpi→xxxhdpi), macOS, Windows, web/PWA PNG sets
- Windows `.ico` (PNG-in-ICO, 16–256px)
- `container-mask.svg` and `container-mask.png` — usable as an Android adaptive mask
- `container-spec.json` — check it into your repo; icon geometry becomes reviewable in a PR
- All of the above as a single `.zip`

## Layout

```
src/core/       spec, geometry, compose, replicate, export, hash  (no React)
src/components/ SpecPanel, Preview, GeneratePanel, DeterminismPanel, ExportPanel, DriftLab
src/state/      useProject (autosaves to localStorage)
server/         Replicate proxy — holds the token, re-serves images same-origin
test/           geometry + determinism
docs/           the diagnosis, the market research
```

`src/core/` is React-free and side-effect-free on purpose: the geometry is
testable in Node without a DOM, which is what makes the determinism claim
checkable in CI.

## Commands

```bash
npm run dev          # app + proxy
npm run build        # typecheck + production build
npm test             # geometry and determinism tests
npm run screenshots  # capture docs/screenshots (needs `vite preview` running)
```

## Notes

- The image proxy allowlists Replicate hosts only — it is not a general fetcher.
  It exists because Replicate's CDN sends no permissive CORS header, which would
  taint the canvas and break compositing, keying and hashing together.
- Canvas sizes are forced even. An odd canvas puts the centre on a half-pixel
  and the two sides of every corner round differently.
- The ZIP writer uses stored entries. PNGs are already DEFLATE-compressed, so a
  second pass would add a dependency to save low single digits.
