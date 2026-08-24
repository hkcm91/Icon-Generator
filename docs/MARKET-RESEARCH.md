# Market research — where the AI icon tools leave a gap

Surveyed August 2026. Sources listed at the end.

## The landscape splits three ways

**1. Pixel-first generators** — Iconikai, Appicons.ai, Canva AI, Illustroke,
Iconify AI. Prompt in, PNG out, platform sizes exported. Fast (Iconikai
advertises ~8 seconds) and cheap ($10–30/mo is the standard band, free tiers
everywhere). The model draws the entire icon, silhouette included.

**2. Vector-native generators** — Recraft is the clear leader, generating real
SVG rather than tracing a raster afterwards, with one-click icon-set creation.
This is a genuine capability gap over group 1 and the main reason Recraft keeps
showing up at the top of comparisons.

**3. Post-hoc shapers** — SVGMaker, appicon.co, Axialis. These apply the iOS
squircle mask, split Android adaptive foreground/background layers, and emit
`.ico`/`.icns` multi-resolution binaries. They do the geometry correctly, but
only *after* the art exists, and only as a crop.

## The consistency problem is openly unsolved

This is the theme across every comparison and every practitioner write-up:

- Consistency is described as "one of the hardest problems in icon design", with
  set coherence being what actually determines whether an icon pack has value.
- The best documented technique is still *prompt discipline*: keep a verbatim
  style stem across every prompt and vary only the subject. Reported results —
  coherent sets on the first generation about two-thirds of the time, the rest
  needing one or two refinements.
- Reviewers repeatedly flag that users "may want more granular control over icon
  set consistency", and the standing advice is to expect refinement and manual
  vector cleanup before production.

Two-thirds-on-the-first-try is a reasonable hit rate for illustration. For a
120-icon family where every tile sits on the same home screen, it means roughly
40 icons need rework, and the failures are exactly the ones that are hardest to
see one at a time and impossible to miss in a grid.

## The gap

**Nobody separates geometry from material.**

Every tool surveyed treats the container as something the model draws (groups 1
and 2) or something you crop afterward (group 3). Both put the model in charge
of where an edge is:

- Group 1 & 2: the silhouette is generated, so it is re-decided every run.
- Group 3: masking is subtractive. It can trim art that overflows the shape, but
  it cannot correct art that undershoots it, and it cannot make a family agree —
  it just crops each member to the same outline while their internal geometry,
  optical weight and corner treatment still disagree.

The unoccupied position:

> **Geometry is compiled from a spec. Material is generated. The model is never
> asked about shape.**

Under that inversion, set consistency stops being a prompt-discipline problem
and becomes a *type* problem — a property of the data structure, not a
probability. Zero of the surveyed tools do this.

## Adjacent gaps worth taking

| Gap | Status across surveyed tools | Notes |
|---|---|---|
| Provable determinism | None offer it | "Re-render N times, hash the pixels" is trivial to ship and impossible to fake |
| Native-size rendering | Universally downscaled from one master | A 16px favicon resampled from 1024px is mush; re-rendering from a path is not |
| Spec as a portable artefact | None | A `container-spec.json` in the repo makes icon geometry reviewable in a PR |
| Superellipse as a real parameter | Presets only, if at all | Most expose "squircle" as a fixed shape; the exponent is the interesting control |
| Token custody | Varies; several are cloud-only | Server-side token, self-hostable, no art leaves the pipeline |
| Open format | All proprietary | The spec is 9 numbers; there is no moat in hiding it |

## Positioning

Not competing on prompt quality, model access, or speed — those are commoditised
and Recraft/Iconikai are ahead. Competing on **the thing that makes a family a
family**: geometry you can specify, version, diff, and prove.

The natural pitch is the complaint that started this: *"the radius is slightly
different every generation."* Every tool in groups 1–3 has that failure mode.
None of them can honestly claim otherwise, because in all three the shape is
downstream of a sampler.

## Sources

- [Top 12 AI Icon Generators: Complete 2026 Comparison Guide](https://svgmaker.io/blogs/12-best-ai-icon-generators-in-2026)
- [8 Best AI App Icon Generators 2026 (Tested & Ranked) — IconikAI](https://www.iconikai.com/blog/best-ai-app-icon-generators-2026)
- [Best AI Icon Generators for Creatives in 2026 — Envato](https://elements.envato.com/learn/best-ai-icon-generators)
- [The 12 Best AI App Icon Generators in 2026 — AppLaunchFlow](https://www.applaunchflow.com/blog/best-ai-app-icon-generators-2026)
- [AI Icon Generator: Everything You Need to Know — IconScout](https://iconscout.com/blog/ai-icon-generator-everything-you-need-to-know-quick-guide)
- [Can AI design unique, consistent icon sets from a simple style brief?](https://www.jeffbullas.com/thread/can-ai-design-unique-consistent-icon-sets-from-a-simple-style-brief/)
- [7 AI tools that create brand-consistent icon sets](https://www.howdoiuseai.com/blog/2026-03-09-7-ai-tools-that-create-brand-consistent-icon-sets-)
- [AI SVG Icon Generator: A Developer's Guide to Production Icon Sets — SVG AI](https://www.svgai.org/blog/specialized-svg-applications/generating-svg-icons-ai)
- [AI App Icon Generator — SVGMaker](https://svgmaker.io/ai-icon-generator)
- [App Icon Generator — appicon.co](https://www.appicon.co/)
- [Icon Generator for App Icons and UI Icon Sets — Axialis](https://www.axialis.com/icongenerator/)
- [The Squircle Formula: Superellipse Math Explained](https://squircle.js.org/blog/math-behind-squircles)
- [How Apple Uses Squircles in iOS Design](https://squircle.js.org/blog/squircles-in-apple-design)
- [Desperately seeking squircles — Figma](https://www.figma.com/blog/desperately-seeking-squircles/)
- [My Quest for the Apple Icon Shape — Liam Rosenfeld](https://liamrosenfeld.com/posts/apple_icon_quest/)
- [Understanding iOS Squircle Continuous Curvature — AppScreenStudio](https://www.appscreenstudio.com/en/blog/understanding-ios-squircle-continuous-curvature)
