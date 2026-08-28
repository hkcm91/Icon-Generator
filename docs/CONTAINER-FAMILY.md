# The container family — empty vessels, composited glyphs

Concepts for icon containers with nothing in them, and the workflow that lets a
glyph be dropped in afterwards instead of generated in place.

Companion to [MARKET-RESEARCH.md](MARKET-RESEARCH.md), which covers the AI icon
*tools*. This one covers the icon *market* — Etsy, August 2026 — and the twelve
containers that follow from it. The catalogue is code, in
[`src/core/containers.ts`](../src/core/containers.ts).

## The problem this fixes

The previous approach generated a container and then asked a model to add a 3D
glyph to it. Two failures, both structural:

- **Slow.** Every glyph is a fresh generation against a fresh container, so cost
  and wall-clock scale with `glyphs × containers`.
- **Inconsistent.** The glyph is re-invented per icon. Weight, perspective,
  material and light direction all drift, and drift is invisible one icon at a
  time and glaring in a grid.

Separating the two axes turns `glyphs × containers` generations into
`glyphs + containers` generations plus free compositing. Twelve containers and
two hundred glyphs is 212 renders, not 2,400.

## The layer contract

**A container is not one PNG. It is a stack with a hole in it.**

```
  shadow      contact shadow, outside the mask
  back        body tint, back-face caustics — what shows through behind
  cavity      ambient occlusion where the glyph meets the walls   (multiply)
  ─────────   ◄── the glyph is inserted here
  body        glass in front of the glyph: tint density, frost, fringing
  specular    highlights, top-edge glint, rim light                 (screen)
```

The ordering is the whole trick. A glyph composited **under** the specular pass
reads as being inside the glass. The same glyph composited **over** a finished
container reads as a sticker. Nothing else in this document matters as much as
that one line.

### Getting the layers without a 3D renderer

Image models will not emit passes, and they do not have to. A single container
render plus the exact mask — already exact, because geometry is compiled from
the spec rather than drawn — splits into a usable stack by luminance:

| Plate | Derivation |
|---|---|
| `specular` | Pixels above `specularCut` of the render's luminance range, alpha-keyed |
| `body` | The remainder |
| `back` | `body`, blurred by `backBlur`, at `backFalloff` opacity |

Two thresholds, one render. `measure.ts` already has the luminance and masking
primitives; `specularCut` and friends are per-form in `containers.ts` because a
matte chiclet and a cut-crystal facet do not split at the same threshold.

The optional fourth plate is a **displacement map** — the glyph warped by
`slot.refract` before compositing, with `slot.fringe` of chromatic offset. That
is what stops a flat glyph reading flat inside a lens.

### The glyph slot

`glyphInset` and `glyphSafePath` already say exactly where the slot is. What
each form adds is what the glass *does* to whatever lands there:

- `scale` — a lens magnifies, a well shrinks
- `offsetY` — where the optical centre actually is, which is rarely the middle
- `depth` — how far back in the volume, driving veiling, blur and cavity AO
- `refract` — barrel displacement
- `fringe` — chromatic separation at the glyph edge

These are properties of the **form**, not the material. A lens magnifies whether
it is tinted blue or amber.

### One light rig, stated every time

`LIGHT_RIG` is repeated verbatim in every container prompt. This is the highest
leverage line in the catalogue: a family whose highlights disagree cannot share
one glyph treatment, because the glyph's own shading has to pick a direction and
commit to it. Fix the rig across the family and one glyph set works in every
container.

`EMPTY_CLAUSE` goes last in every prompt, because a diffusion model asked for
"an icon" will put something in the middle every single time, and a trailing
instruction survives truncation better than a buried one.

## The twelve forms

Three axes, kept independent: **form** (the volume), **material** (what it is
made of), **slot** (what happens to a glyph put inside).

| Form | The physical read | Slot behaviour |
|---|---|---|
| **Slab** | Flat plate, chamfered edge; thickness reads only at the bevel | Neutral. Highest legibility |
| **Cabochon** | Flat back, domed front — the Aqua button, the hard candy | Slight magnification |
| **Lens** | Biconvex, thick through the middle; genuinely magnifies | Heavy: 1.35× and 0.7 refraction |
| **Pillow** | Inflated, soft, edges swell outward, no hard bevel | Gentle emboss |
| **Well** | Concave basin, surface below the rim, liquid pooled | Small, shadowed, real AO |
| **Capsule** | Sealed chamber: front wall, back wall, air between | An honest, literal place to put it |
| **Frame** | Glass bezel only; the centre is open to the wallpaper | Unobstructed |
| **Wafer** | Two or three plates stacked, laminated edge visible | Mid-plate, free parallax |
| **Droplet** | A bead held by surface tension, outline slightly irregular | Strong refraction, caustic below |
| **Bulb** | Thin blown shell, hollow, milky, one hot spot | Deeply veiled |
| **Facet** | Cut crystal, hard edges, prismatic dispersion | High fringe budget |
| **Chiclet** | Soft-touch matte plastic, opaque, no specular at all | Nothing veils it |

Chiclet is the deliberate odd one out. Every glass family needs one opaque
member or the set has no tonal floor.

### Ten materials

`clear` · `aqua` · `opal` · `holo` · `chrome` · `jelly` · `vinyl` · `amber` ·
`obsidian` · `pearl`

Twelve forms × ten materials is 120 containers from 22 written descriptions.

**Build a family along one axis at a time.** One form across many materials, or
one material across many forms. Both read as a set. Varying both at once is the
usual reason a generated set fails to cohere — there is no through-line left for
the eye to hold onto.

## Etsy, August 2026

### Liquid glass is the live category, and it is young

The current standout is [232 Liquid Glass App Icons for iOS &
Android](https://www.etsy.com/listing/4451752784/232-liquid-glass-app-icons-for-ios)
by StarrySoulDesign — €8.80, 735 favourites, Star Seller, high recent sales
volume. It was **listed on 17 August 2026**. A pack that new sitting at the top
of the category means the category has not settled. There is no incumbent with
two years of reviews to outrank.

Driving it: iOS 26 shipped Liquid Glass to over 1.5 billion iPhones, and the
system look is now translucency, lensing and specular highlights that track the
gyroscope. Every home screen is a glass home screen, and stock icons no longer
match the chrome around them.

### What the shelf looks like

| | Observed |
|---|---|
| Price | $5–15, clustered around $8–10 |
| Pack size | 100–250 is the working band (232, 233, 250, 210, 162, 100) |
| Bundle | Icons + wallpapers + widgets + app covers is now the default, not a bonus |
| Format | ZIP of PNGs, plus a PDF of Shortcuts install instructions |
| Differentiator | "Lifetime updates" appears on the stronger listings |

Existing glass packs cluster on three finishes: **clear**, **frosted**, and
**obsidian/dark**. That is three of the ten materials above.

### The gap

Y2K materials — holographic, chrome, iridescent, gel — are all over Etsy, but
almost entirely as **craft clipart**: sublimation PNGs for t-shirts, tumblers,
stickers and magnets. They are sold to crafters, not to phone customisers. The
Y2K *app icon* packs that do exist are flat 2D throwbacks.

Nobody is rendering Y2K materials in the iOS 26 liquid-glass form language.
That intersection is the wedge, and it is exactly what the form × material
matrix produces.

### Why the container family is the business, not just the design

Every pack on Etsy is a fixed pack: one style, one glyph set, shipped as a unit.
Under the two-axis workflow, the glyph set and the container are separate
inventory:

> **One glyph library × twelve containers = twelve products.**

The marginal cost of the twelfth product is twelve container renders and a
compositing pass. That is a structurally different economics from redrawing 232
icons per style, and it is only available because geometry is compiled rather
than generated.

Two adjacent notes from the shelf survey: bundle wallpapers and widgets from the
start (buyers now expect them), and the same container family in a Frame form is
the natural "shows your wallpaper through it" listing that nothing else offers.

## Sources

- [232 Liquid Glass App Icons for iOS & Android — StarrySoulDesign](https://www.etsy.com/listing/4451752784/232-liquid-glass-app-icons-for-ios)
- [100 Obsidian Glass Morphism Style App Icon Pack](https://www.etsy.com/listing/4342410472/100-obsidian-glass-morphism-style-app)
- [Liquid Glass Icon Pack — Etsy market](https://www.etsy.com/au/market/liquid_glass_icon_pack)
- [iOS 26 Icon Pack — Etsy market](https://www.etsy.com/market/ios_26_icon_pack)
- [Glassmorphism Icons — Etsy market](https://www.etsy.com/market/glassmorphism_icons)
- [Y2K App Icon Pack (233 icons, 7 backgrounds, 7 widgets)](https://www.etsy.com/listing/1704603973/y2k-app-icon-pack-233-icons-7)
- [Y2K Icon Pack — Etsy market](https://www.etsy.com/market/y2k_icon_pack)
- [30+ Y2K 3D Holographic PNG Icons](https://www.etsy.com/listing/4348961879/30-y2k-3d-holographic-png-icons-chrome)
- [Aqua Icons — Etsy market](https://www.etsy.com/market/aqua_icons)
- [App Icon Packs — Etsy market](https://www.etsy.com/market/app_icon_packs)
- [iOS 26 Liquid Glass: Swift/SwiftUI reference](https://github.com/conorluddy/LiquidGlassReference)
- [iOS and iPadOS 26: The MacStories Review](https://www.macstories.net/stories/ios-and-ipados-26-the-macstories-review/2/)
- [iOS 26 vs iOS 18: Liquid Glass versus flat design — AppleInsider](https://appleinsider.com/articles/25/06/10/ios-26-vs-ios-18-is-apples-liquid-glass-a-true-redesign)
