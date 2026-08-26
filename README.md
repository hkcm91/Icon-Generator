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

## The walkthrough

The app opens on a **walkthrough**, in two tracks — pick either from the
switcher at the top, or **Tutorial** in the header. Skip it and it stays
skipped; the track you were last on is remembered.

| Track | For | Runtime |
|---|---|---|
| **Your first icon** | Never seen the app. The master you already have, out as a full set: upload, the two wording fields, one generation, download. | ~45s |
| **Making a family** | Already using it. The glyph library, batch size, redoing one bad card, transparency, and what survives a reload. | ~35s |

They play themselves, but neither is a cutscene. Every scene is reachable
from the chapter rail, `←`/`→` step, space pauses, `Esc` closes, and someone
who has asked for reduced motion gets the same words with the pictures held
still.

Deliberately absent from both: geometry sliders, conditioning modes, the
determinism check, the measurement tools. They are all real and all
documented below, and none of them are on the path from one icon to a
downloaded set.

The script lives in [`src/core/tutorial.ts`](src/core/tutorial.ts) as plain
data, so what it claims is reviewable in a diff. `test/tutorial.test.ts` ties
those claims to the code they describe: the shape presets it names must be
the ones the guided view renders, the glyph count must match what the three
bundled catalogues actually hold, the transparency scene may only call the
feature model-dependent while the model roster is genuinely mixed, and
neither track may run 60 seconds or longer.

## Two views

The app opens in a **guided view**: pick a shape, describe the look, generate,
download. Three inputs and four steps.

Uploading a master through **From my icon** does everything in one step: traces
the outline into the spec, reads the palette and finish, and fills the Surface
field and base colour. Naming the symbol needs a vision model; everything else
is measured from the pixels, so it works offline and is identical on every run.

The master is not only analysed — it is passed as a reference to **every**
generation, so the whole family inherits one look rather than drifting apart
prompt by prompt.

**Make a whole family** gives you **7,400 built-in glyphs** — Material Symbols
(3,899), brand marks (3,453) and the Y2K Dream set (48) — searchable, add any
number at once. Or import your own list: a CSV, a JSON manifest, or one name per
line, hundreds at a time. Select any number, generate them
as a bounded-concurrency batch, and redo individual cards that came out wrong.

Rendered icons persist across a refresh. Layers are stored as PNG blobs in
IndexedDB rather than in the project JSON — localStorage caps out around 5MB and
a single 1024px render is a few hundred KB as a data URL — so a family of
several hundred survives a reload intact.

**All controls** switches to the full workspace — geometry sliders, shape
conditioning, the determinism check, drift comparison, per-platform export, and
the measurement tools. Everything below describes that view; none of it is
needed to get an icon out.

## Quick start

```bash
npm install
npm run dev               # web on :5173, proxy on :8787
```

Then click **Add API key** in the header and paste your Replicate token. It is
checked against Replicate before being kept, then attached to each request.

## Deploying

The API lives in `api/` as serverless functions, so deploying the repository is
all that is needed — on Vercel it is detected automatically (`vercel.json` sets
the Vite build and the SPA rewrite). `npm run dev` mounts those same handlers
behind Express, so local and deployed run identical code.

Two ways to supply the key, and the choice matters:

| Where | Behaviour | Use when |
|---|---|---|
| `REPLICATE_API_TOKEN` env var | Every visitor uses the deployment owner's key | Private deployment, or you intend to pay for everyone |
| **Add API key** in the app | Held in that visitor's browser, sent per request | Your own key; anything others can reach |

There is no third option on serverless: functions are stateless, so a key
"saved" during one request does not exist in the next.

**Generation is started and polled separately** — `POST /api/generate` returns a
prediction id and the browser polls `GET /api/prediction`. An image model can
take minutes, and a serverless function is capped well below that, so anything
waiting for the result inside one request works locally and times out deployed.

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

### Trace a master into the spec

Better than measuring after the fact: drop the master you already approved and
its outline *becomes* the container. Three modes — traced and evened out
(recommended), traced verbatim, or the closest clean superellipse — with
**off-ideal** and **asymmetry** reported so the choice is informed. Traced modes
emit a `custom-path` spec that compiles through the same pipeline as any preset.

Images that arrive fully opaque — which is most model output, whatever the
prompt asked for — are keyed against the flat background before measuring, and
flagged as `keyed` in the table.

## Exports

Every size is a **fresh render from the path**, not a downscale of one master —
so a 16px corner is antialiased for 16px instead of resampled from 1024px.

- **iOS** — a complete `AppIcon.appiconset`: all 18 role slots with the
  `Contents.json` that names them, ready to drag into an asset catalogue.
  Written as truecolour PNG with **no alpha channel**, because App Store
  Connect rejects an app icon for carrying the channel at all rather than only
  for containing transparent pixels, and composed **full bleed**, because iOS
  applies its own superellipse and an already-inset icon gets masked twice.
- **Android** — a real `res/` tree: `ic_launcher_background`,
  `ic_launcher_foreground` and `ic_launcher_monochrome` at all five densities,
  the `mipmap-anydpi-v26/ic_launcher.xml` that binds them into an adaptive
  icon, a flattened `ic_launcher.png` for pre-26 launchers, and the 512px Play
  listing icon. Layers are authored on the 108dp canvas with the artwork inside
  the 66dp that survives every launcher mask.

  Emitting genuine layers is nearly free here and is not, generally: the
  material and the glyph were never flattened together, so there is nothing to
  segment back apart.
- macOS, Windows and web/PWA PNG sets
- Windows `.ico` (PNG-in-ICO, 16–256px)
- `container-mask.svg` and `container-mask.png` — usable as an Android adaptive mask
- `container-spec.json` — check it into your repo; icon geometry becomes reviewable in a PR
- All of the above as a single `.zip`

## Layout

```
src/core/       spec, geometry, compose, replicate, export, png, hash, tutorial  (no React)
src/components/ SimpleStudio, Tutorial, SpecPanel, Preview, GeneratePanel,
                DeterminismPanel, ExportPanel, DriftLab
src/state/      useProject (autosaves to localStorage)
server/         Replicate proxy — holds the token, re-serves images same-origin
test/           geometry, determinism, PNG encoding, platform rules, walkthrough
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
