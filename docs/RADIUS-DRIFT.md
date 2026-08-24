# Why the radius changed every generation — and what fixes it

## Short answer

Yes, generating onto a JSON/vector container shape is possible, and it is the
correct fix. The drift is not a tuning problem, a seed problem, or a model
problem. It is caused by asking an image model to be the authority on geometry.
No amount of prompt engineering fixes that, because the model has no mechanism
to honour a number.

## Where the drift comes from in the current pipeline

Three independent causes, all in `tools/icon-family-studio/electron/main.ts`.

### 1. Geometry is sent as prose (`main.ts:3459`)

```ts
`Requested geometry: ${project.template.shape}; radius ${project.template.radius}%; ` +
`optical margin ${project.template.padding}%; depth ${project.recipe.container.depth}%; ...`
```

This is the primary cause. A diffusion model reads `radius 30%` as a stylistic
hint, not a constraint. Every generation re-decides what that looks like. Two
runs of the *same* prompt with the same settings land on different curvature,
which is exactly the symptom.

### 2. The mask can only cut corners off, never fill them in (`enforceTemplateShape`)

The analytic template mask is applied with `blend: 'dest-in'`:

```ts
const clipped = await sharp(base)
  .composite([{ input: mask, blend: 'dest-in' }])
```

`dest-in` keeps pixels where the mask is opaque. So it erases anything the model
drew *outside* the ideal shape — but if the model drew a **tighter** radius than
the template (a rounder corner), those corners fall entirely *inside* the mask
and nothing is clipped at all. The wrong radius survives untouched.

The constraint is one-sided. It can only ever make a container squarer, never
rounder, and it silently no-ops in the direction the drift most often goes.

### 3. Trim-then-rescale re-quantises the corner (`prepareLockedContainer`)

```ts
trimmed = await sharp(cleaned).trim({ background: {...}, threshold: 10 })
const subject = await sharp(trimmed).resize(target, target, { fit: 'contain', ... })
```

The bounding box comes from whatever the model actually drew — including glow,
bloom and shadow spill, which vary per generation. The same nominal radius
therefore maps to a different pixel radius on every run. `fit: 'contain'` on a
non-square trim result adds asymmetric letterboxing on top.

### Bonus bug: the radius slider does nothing in squircle mode

```ts
const radius = t.shape === 'circle' ? inner / 2
  : t.shape === 'squircle' ? inner * .23      // <- t.radius never read
  : t.shape === 'rounded' ? inner * Math.min(.5, t.radius / 100) : 0;
```

`squircle` is hardcoded to `0.23 × inner` and ignores `t.radius` entirely. It is
also drawn as a plain `<rect rx>`, which is a rounded rectangle — a circular arc
spliced onto a straight edge — not a squircle. A real squircle is a superellipse
with continuous curvature, and the two are visibly different at icon sizes.

## The fix: invert the authority

```
        BEFORE                                   AFTER

  spec ──► prose prompt ──► model            spec ──► exact path ──┐
                             │                                     ├──► clip ──► icon
                             ▼                 model ──► material ─┘
                        silhouette
                       (drifts)               model never sees the geometry
```

Geometry is **compiled**, not prompted:

- The container is a JSON `ContainerSpec` → a pure function → an exact SVG path.
- The model is asked only for a **full-bleed material** (no edges, no subject)
  and a **centred glyph** (on a flat chroma field).
- Compositing clips both to the analytic path. Nothing the model produces can
  move an edge by a pixel, because the edge was decided before the call.

This also removes the second-order problems for free:

| Problem | Why it disappears |
|---|---|
| Family members disagree on shape | Every icon compiles from one spec |
| Small sizes look mushy | Each size is re-rendered natively, not downscaled |
| Rim/bevel highlight follows the wrong curve | The rim is stroked on the same path |
| Glyph crowds the corner | Safe area is the container contour scaled about its centre |

## What the implementation does

`src/core/geometry.ts`, pure functions only — no clock, no randomness:

- **`rounded-rect`** — exact arcs. `radius: 25` on a 1000px box is 250px. Always.
- **`circle`** — exact.
- **`superellipse`** — `|x/a|ⁿ + |y/b|ⁿ = 1`, the real squircle family.
  `n=2` ellipse, `n=4` Lamé squircle, `n=5` closest single-exponent match to
  Apple's icon mask, higher = squarer.
- **`custom-path`** — any SVG path authored in a 0–1000 viewBox.

Two details that took iteration and are worth keeping:

1. **Catmull-Rom, not the analytic derivative.** The parametric derivative of a
   superellipse is *unbounded* at the edge midpoints for every `n > 2`, so
   control points built from it come out infinite.
2. **Curvature-weighted sampling, not arc-length.** At high exponents the
   corners are a tiny fraction of the perimeter, so arc-length-uniform sampling
   starves them of points and the fit bulges past the bounding box — measured at
   1.55px on a 900px shape. Weighting each step by
   `distance + 1.5 × scale × |turn|` spends the sample budget where the shape
   actually happens. Worst-case overshoot drops to **0.52px (0.058%)**, and that
   is a control point, so true curve deviation is smaller still.

Both are covered by tests in `test/geometry.test.ts`, including a 500-iteration
byte-equality check and a bounding-box assertion with the tolerance pinned just
above the measured worst case, so a regression fails loudly.

## Proving it

The app ships a **Determinism check** that re-renders the current icon 10 or 50
times and hashes every frame's raw RGBA. Identical hashes, or it is not fixed.
The **Drift comparison** strip shows six spec-compiled renders against six with
simulated prompted-geometry jitter, side by side.
