/**
 * The container catalogue — empty vessels, no glyphs.
 *
 * A container is described on three independent axes, and keeping them
 * independent is the whole point:
 *
 *   FORM      the shape of the glass volume        (slab, lens, well, ...)
 *   MATERIAL  what the glass is made of            (clear, holo, jelly, ...)
 *   SLOT      where a glyph will later be dropped  (scale, depth, refraction)
 *
 * FORM and MATERIAL multiply: 12 forms x 10 materials is 120 containers from
 * 22 descriptions. SLOT is what lets a glyph be composited in afterwards
 * rather than generated in place, which is the expensive, drifty way.
 *
 * Nothing here is a glyph. Every prompt stem in this file ends by telling the
 * model the container is empty, because a diffusion model asked for "an icon"
 * will put something in the middle every single time.
 */

import type { ContainerSpec } from './spec';

/* ------------------------------------------------------------------ *
 * The layer contract
 * ------------------------------------------------------------------ */

/**
 * A container is not one PNG. It is a stack with a hole in it.
 *
 * The order below is the compositing order, back to front. `glyph` is not a
 * layer the container ships — it is the gap the container leaves.
 *
 * The layer that matters is `specular`. It sits ABOVE the glyph. A glyph
 * composited under the highlight pass reads as being inside the glass; the
 * same glyph composited over the finished container reads as a sticker. That
 * single ordering decision is most of the difference between "3D icon" and
 * "clipart on a shape".
 */
export const LAYER_ORDER = [
  /** Contact shadow and any cast shadow. Outside the mask. */
  'shadow',
  /** Back wall: body tint, back-face caustics, whatever shows through. */
  'back',
  /** Ambient occlusion where the glyph meets the walls. Multiply. */
  'cavity',
  /** ── the glyph is inserted here ── */
  'glyph',
  /** Glass volume in front of the glyph: tint density, frost, fringing. */
  'body',
  /** Highlights, top-edge glint, rim light. Screen/add. Sells the embed. */
  'specular',
] as const;

export type LayerId = (typeof LAYER_ORDER)[number];

/**
 * How to get those layers out of a single generated container.
 *
 * Image models will not emit passes. They do not have to. A container render
 * plus the exact mask (which is already exact, because geometry is compiled)
 * splits into a usable stack by luminance:
 *
 *   specular = pixels above `specularCut` of the container's luminance range
 *   body     = the remainder
 *   back     = body, blurred, at `backFalloff` opacity
 *
 * Two thresholds, one render, no 3D. `measure.ts` already has the luminance
 * and masking primitives this needs.
 */
export interface LayerSplit {
  /** 0-1. Luminance above this becomes the specular plate. */
  specularCut: number;
  /** 0-1. How much of the body reads as the back wall behind the glyph. */
  backFalloff: number;
  /** Blur in px at 1024, applied to the back plate. */
  backBlur: number;
}

export const DEFAULT_SPLIT: LayerSplit = {
  specularCut: 0.82,
  backFalloff: 0.55,
  backBlur: 12,
};

/* ------------------------------------------------------------------ *
 * The glyph slot
 * ------------------------------------------------------------------ */

/**
 * Where a glyph goes and what the glass does to it on the way in.
 *
 * These are per-FORM, not per-material: a lens magnifies whatever is behind
 * it regardless of whether it is tinted blue, and a well swallows a glyph
 * whether the liquid is water or resin.
 */
export interface GlyphSlot {
  /** Multiplier on the spec's glyph safe area. Lenses magnify, wells shrink. */
  scale: number;
  /** Vertical offset as a fraction of size. Positive is down. */
  offsetY: number;
  /**
   * 0-1. How deep inside the volume the glyph sits. Drives how much `body`
   * veils it, how much blur it takes, and how strong the cavity AO is.
   */
  depth: number;
  /**
   * 0-1. Barrel displacement applied by the glass before compositing.
   * 0 is a flat plate; high values are a fisheye and need a real glyph, not
   * a hairline one — thin strokes fall apart under displacement.
   */
  refract: number;
  /**
   * 0-1. Chromatic fringing at the glyph edge, in the same direction as the
   * displacement. Cheap, and it is what stops a composite reading as flat.
   */
  fringe: number;
}

/* ------------------------------------------------------------------ *
 * Forms
 * ------------------------------------------------------------------ */

export interface ContainerForm {
  id: string;
  label: string;
  /** The physical read, in one line. */
  blurb: string;
  /** Geometry patch, applied over DEFAULT_SPEC. */
  spec: Partial<ContainerSpec>;
  slot: GlyphSlot;
  split: LayerSplit;
  /**
   * The form half of the prompt. Describes the volume and nothing else — no
   * colour, no finish, no subject. Material supplies the rest.
   */
  stem: string;
  /** What this form is good and bad at, for picking one. */
  notes: { good: string; watch: string };
}

/**
 * A fixed light rig, stated identically in every container prompt.
 *
 * This is the single highest-leverage line in the file. A family whose
 * highlights disagree cannot be composited with one glyph treatment, because
 * the glyph's own shading has to pick a direction and commit. Fixing the rig
 * across the family means one glyph set works in every container.
 */
export const LIGHT_RIG =
  'lit by one large soft studio softbox from the upper left at 45 degrees, ' +
  'a dim cool fill from the lower right, one crisp specular hit near the ' +
  'upper-left edge, orthographic straight-on view, perfectly centred';

/** Said last, in every prompt, because models fill empty containers. */
export const EMPTY_CLAUSE =
  'the container is completely EMPTY — no symbol, no glyph, no letter, no ' +
  'logo, no face, no object inside or on it, nothing in the centre — an ' +
  'empty vessel only, isolated on a flat neutral grey background';

export const CONTAINER_FORMS: ContainerForm[] = [
  {
    id: 'slab',
    label: 'Slab',
    blurb: 'A flat plate of glass with a chamfered edge. Thickness reads only at the bevel.',
    spec: { shape: 'superellipse', exponent: 5, padding: 6, glyphInset: 18 },
    slot: { scale: 1, offsetY: 0, depth: 0.25, refract: 0.05, fringe: 0.15 },
    split: DEFAULT_SPLIT,
    stem:
      'a thin flat slab of glass, a plate about one tenth as thick as it is ' +
      'wide, with a narrow polished chamfer running around the whole edge ' +
      'and a bright thin line of light caught along the top bevel',
    notes: {
      good: 'The neutral member. Highest glyph legibility, closest to the iOS 26 system look, safest for brand marks that must stay recognisable.',
      watch: 'Least distinctive on its own — it needs the material to carry the personality.',
    },
  },
  {
    id: 'cabochon',
    label: 'Cabochon',
    blurb: 'Flat back, domed front. The Aqua button, the gemstone, the hard candy.',
    spec: { shape: 'superellipse', exponent: 4, padding: 7, glyphInset: 20 },
    slot: { scale: 1.12, offsetY: 0.01, depth: 0.55, refract: 0.3, fringe: 0.3 },
    split: { specularCut: 0.78, backFalloff: 0.6, backBlur: 16 },
    stem:
      'a cabochon of glass — a flat back with a smoothly domed front face ' +
      'rising to a rounded crown in the centre, thickest at the middle, ' +
      'with one broad soft highlight across the upper dome and a tight ' +
      'bright glint above it',
    notes: {
      good: 'The Y2K workhorse. The dome magnifies the glyph slightly, which flatters simple shapes and reads instantly as early-2000s.',
      watch: 'The dome fights dense glyphs. Keep the glyph under ~55% coverage.',
    },
  },
  {
    id: 'lens',
    label: 'Lens',
    blurb: 'Biconvex, thick through the middle. It genuinely magnifies what sits behind it.',
    spec: { shape: 'circle', padding: 5, glyphInset: 22 },
    slot: { scale: 1.35, offsetY: 0, depth: 0.75, refract: 0.7, fringe: 0.55 },
    split: { specularCut: 0.85, backFalloff: 0.45, backBlur: 20 },
    stem:
      'a thick biconvex lens of optical glass, bulging on both faces, ' +
      'heaviest at the centre and tapering to a thin polished rim, with a ' +
      'ring of concentrated light around the inside of the rim and visible ' +
      'colour dispersion where the glass is thickest',
    notes: {
      good: 'The most physically convincing "liquid glass" read. Strong lensing means the composite is obviously not a sticker.',
      watch: 'Needs a chunky glyph. Hairline strokes shear apart under 0.7 displacement.',
    },
  },
  {
    id: 'pillow',
    label: 'Pillow',
    blurb: 'Inflated and soft. The edges swell outward; there is no hard bevel anywhere.',
    spec: { shape: 'superellipse', exponent: 3.4, padding: 8, glyphInset: 22 },
    slot: { scale: 1.05, offsetY: -0.005, depth: 0.4, refract: 0.25, fringe: 0.2 },
    split: { specularCut: 0.74, backFalloff: 0.65, backBlur: 18 },
    stem:
      'an inflated pillow of soft translucent material, puffed up like a ' +
      'sealed air cushion, the edges swelling outward and rounding over ' +
      'with no sharp bevel, a wide diffuse sheen across the upper surface ' +
      'and a gentle crease where the seam would run',
    notes: {
      good: 'Reads as touchable. Best pairing for gel, vinyl and jelly materials; excellent for a cute or kawaii family.',
      watch: 'Swelling edges eat into the silhouette — raise padding or the family loses its shared outline.',
    },
  },
  {
    id: 'well',
    label: 'Well',
    blurb: 'Concave basin. The surface sits below the rim, with liquid pooled at the bottom.',
    spec: { shape: 'superellipse', exponent: 5, padding: 6, glyphInset: 26 },
    slot: { scale: 0.82, offsetY: 0.02, depth: 0.85, refract: 0.35, fringe: 0.25 },
    split: { specularCut: 0.8, backFalloff: 0.75, backBlur: 22 },
    stem:
      'a shallow concave basin cut into a block of glass, the walls sloping ' +
      'inward to a flat floor well below the rim, a bright meniscus ring ' +
      'where the pooled liquid climbs the wall, the rim catching a hard ' +
      'highlight while the floor stays in soft shadow',
    notes: {
      good: 'The only inverted form. Gives a family instant variety and puts real ambient occlusion around the glyph, which is very hard to fake otherwise.',
      watch: 'The glyph lands small and shadowed. Bad for fine brand marks, superb for single bold symbols.',
    },
  },
  {
    id: 'capsule',
    label: 'Capsule',
    blurb: 'A sealed hollow chamber: a front wall, a back wall, and air in between.',
    spec: { shape: 'superellipse', exponent: 5, padding: 6, glyphInset: 24 },
    slot: { scale: 0.95, offsetY: -0.01, depth: 0.6, refract: 0.2, fringe: 0.35 },
    split: { specularCut: 0.83, backFalloff: 0.4, backBlur: 26 },
    stem:
      'a sealed hollow capsule of glass with two distinct parallel walls and ' +
      'an air gap between them, the front wall clear and the back wall ' +
      'visible through it slightly out of focus, a double reflection where ' +
      'the light catches both surfaces',
    notes: {
      good: 'The premium read, and mechanically the best form for compositing — the air gap is a literal, honest place to put the glyph.',
      watch: 'Two-wall specular means two highlight passes. Keep the split threshold high or the plate blows out.',
    },
  },
  {
    id: 'frame',
    label: 'Frame',
    blurb: 'A glass bezel only. The middle is open to whatever is behind it.',
    spec: { shape: 'superellipse', exponent: 5, padding: 5, glyphInset: 14 },
    slot: { scale: 1.0, offsetY: 0, depth: 0.1, refract: 0.0, fringe: 0.1 },
    split: { specularCut: 0.86, backFalloff: 0.2, backBlur: 8 },
    stem:
      'a hollow ring of glass — a thick polished bezel following the outline ' +
      'with the entire centre open and empty, showing the background ' +
      'straight through it, the inner and outer edges of the bezel each ' +
      'catching their own line of light',
    notes: {
      good: 'Maximum glyph legibility and the only form where the wallpaper shows through. Wins on a busy home screen.',
      watch: 'Weakest glass read, because there is barely any glass. Pair with the loudest materials.',
    },
  },
  {
    id: 'wafer',
    label: 'Wafer',
    blurb: 'Two or three thin plates stacked with a visible laminated edge.',
    spec: { shape: 'superellipse', exponent: 6, padding: 7, glyphInset: 20 },
    slot: { scale: 1.0, offsetY: 0, depth: 0.5, refract: 0.15, fringe: 0.4 },
    split: { specularCut: 0.81, backFalloff: 0.5, backBlur: 14 },
    stem:
      'three thin plates of glass stacked face to face and very slightly ' +
      'rotated out of alignment, the laminated edges visible as distinct ' +
      'stacked lines around the outline, each layer catching its own ' +
      'reflection so the edge reads as banded',
    notes: {
      good: 'The clearest Y2K jewel-case / CD reference. The offset layers give a free parallax cue.',
      watch: 'The rotation must be tiny and identical across the family, or the silhouettes stop matching.',
    },
  },
  {
    id: 'droplet',
    label: 'Droplet',
    blurb: 'A bead of liquid held by surface tension. The outline is not quite regular.',
    spec: { shape: 'superellipse', exponent: 3.6, padding: 8, glyphInset: 24 },
    slot: { scale: 1.2, offsetY: 0.015, depth: 0.7, refract: 0.6, fringe: 0.45 },
    split: { specularCut: 0.88, backFalloff: 0.6, backBlur: 18 },
    stem:
      'a bead of clear liquid resting on a surface, held in shape by ' +
      'surface tension, the outline gently irregular and slightly wider at ' +
      'the base than the top, one small intense pinpoint highlight and a ' +
      'bright caustic pooled underneath where light focuses through it',
    notes: {
      good: 'The most alive of the forms, and the best excuse for real caustics under the icon.',
      watch: 'Irregularity is a family risk. Let the geometry stay exact and put the wobble in the material pass only.',
    },
  },
  {
    id: 'bulb',
    label: 'Bulb',
    blurb: 'A thin blown shell, hollow, milky, with one hot spot of light.',
    spec: { shape: 'circle', padding: 6, glyphInset: 22 },
    slot: { scale: 0.9, offsetY: 0, depth: 0.9, refract: 0.3, fringe: 0.2 },
    split: { specularCut: 0.9, backFalloff: 0.8, backBlur: 30 },
    stem:
      'a thin blown shell of glass, hollow and lit from inside, the wall ' +
      'thin enough to glow where the light passes through and denser near ' +
      'the silhouette edge, one small hot spot of reflected light on the ' +
      'upper left and a soft even luminance everywhere else',
    notes: {
      good: 'The softest, warmest member. Reads as lit rather than reflective, which no other form in this family does.',
      watch: 'Depth 0.9 means the glyph is heavily veiled. Use high-contrast glyphs only.',
    },
  },
  {
    id: 'facet',
    label: 'Facet',
    blurb: 'Cut crystal. Flat faces meeting at hard edges, throwing prismatic colour.',
    spec: { shape: 'superellipse', exponent: 7, padding: 6, glyphInset: 22 },
    slot: { scale: 1.08, offsetY: 0, depth: 0.65, refract: 0.5, fringe: 0.7 },
    split: { specularCut: 0.87, backFalloff: 0.5, backBlur: 10 },
    stem:
      'a piece of cut crystal with flat polished facets meeting at crisp ' +
      'edges, a large table facet in the centre surrounded by angled ' +
      'bevels, each facet reflecting a different value and throwing ' +
      'prismatic rainbow dispersion where the light exits',
    notes: {
      good: 'Highest perceived value per icon, and the strongest fringe budget — dispersion hides compositing seams.',
      watch: 'Facet layout wants to be identical across the family or the set looks random. Lock it with a reference image.',
    },
  },
  {
    id: 'chiclet',
    label: 'Chiclet',
    blurb: 'Soft-touch matte plastic. Dense, no reflection, only a wide soft terminator.',
    spec: { shape: 'superellipse', exponent: 4.5, padding: 7, glyphInset: 20 },
    slot: { scale: 1.0, offsetY: 0, depth: 0.15, refract: 0.0, fringe: 0.0 },
    split: { specularCut: 0.7, backFalloff: 0.3, backBlur: 6 },
    stem:
      'a soft-touch matte plastic key, dense and completely opaque, with a ' +
      'slightly crowned top face rolling into the sides, no specular ' +
      'reflection at all, only a wide gradual terminator from lit to ' +
      'shadowed and a faint velvety rim where light grazes the edge',
    notes: {
      good: 'The control. Every glass family needs one opaque member for contrast, and it composites perfectly because nothing veils the glyph.',
      watch: 'Not glass. Use it as the odd one out, not as a third of the set.',
    },
  },
];

/* ------------------------------------------------------------------ *
 * Materials
 * ------------------------------------------------------------------ */

export interface ContainerMaterial {
  id: string;
  label: string;
  /** The material half of the prompt. Surface and optics, never shape. */
  stem: string;
  /** Representative hexes, for previews and for seeding the base colour. */
  tint: string[];
  /** 0-1. How much the material veils a glyph behind it. */
  opacity: number;
  /** Forms this pairs with unusually well. */
  pairs: string[];
}

export const CONTAINER_MATERIALS: ContainerMaterial[] = [
  {
    id: 'clear',
    label: 'Optical clear',
    stem:
      'made of colourless optical glass, highly transparent with a faint ' +
      'cool green edge tint where it is thickest, sharp reflections and ' +
      'clean refraction, museum-grade polish',
    tint: ['#eaf4f7', '#b9d7de', '#7fa8b3'],
    opacity: 0.15,
    pairs: ['slab', 'lens', 'capsule', 'facet'],
  },
  {
    id: 'aqua',
    label: 'Water',
    stem:
      'made of clear water with a cyan-to-deep-blue depth gradient, ' +
      'wet-looking, with bright caustic light pooling through it and a ' +
      'trembling meniscus at the edges',
    tint: ['#9fe8ff', '#2fb6e8', '#0a5b8c'],
    opacity: 0.3,
    pairs: ['droplet', 'well', 'lens', 'pillow'],
  },
  {
    id: 'opal',
    label: 'Milky opal',
    stem:
      'made of milky opal glass, semi-translucent and satin-frosted, light ' +
      'scattering softly through the body with a warm amber glow in the ' +
      'thin areas and a cool blue cast in the dense areas',
    tint: ['#fdfbf7', '#e4dced', '#b6a9c9'],
    opacity: 0.6,
    pairs: ['bulb', 'pillow', 'cabochon', 'slab'],
  },
  {
    id: 'holo',
    label: 'Holographic',
    stem:
      'wrapped in iridescent holographic film, the surface shifting through ' +
      'magenta, cyan, lime and gold as the angle changes, oil-slick ' +
      'interference bands following the curvature, high-gloss',
    tint: ['#ff8ae2', '#8affe4', '#ffe98a'],
    opacity: 0.75,
    pairs: ['wafer', 'cabochon', 'frame', 'facet'],
  },
  {
    id: 'chrome',
    label: 'Liquid chrome',
    stem:
      'a mirror-polished liquid chrome surface, fully reflective, bending a ' +
      'simple studio environment of a bright horizon over a dark floor ' +
      'across its curvature, hard-edged reflections, no diffuse component',
    tint: ['#f2f5f8', '#94a5b5', '#2c3a47'],
    opacity: 1,
    pairs: ['droplet', 'pillow', 'cabochon', 'facet'],
  },
  {
    id: 'jelly',
    label: 'Jelly',
    stem:
      'made of translucent candy jelly, deeply saturated, with strong ' +
      'subsurface scattering so the colour glows brightest where the body ' +
      'is thinnest, a wet gummy sheen and slightly tacky-looking surface',
    tint: ['#ff5fa2', '#ff2d6f', '#8c0f3c'],
    opacity: 0.45,
    pairs: ['cabochon', 'pillow', 'droplet', 'well'],
  },
  {
    id: 'vinyl',
    label: 'Soft vinyl',
    stem:
      'moulded from soft matte vinyl, opaque and slightly rubbery, with a ' +
      'faint powdery bloom on the surface and a wide soft falloff, no ' +
      'sharp specular anywhere',
    tint: ['#ffd9c4', '#f2a58a', '#b76a54'],
    opacity: 1,
    pairs: ['chiclet', 'pillow', 'slab'],
  },
  {
    id: 'amber',
    label: 'Resin',
    stem:
      'cast in clear amber resin with tiny suspended bubbles and fine ' +
      'glitter inclusions caught at different depths, honey-warm, deep and ' +
      'syrupy where it is thick',
    tint: ['#ffd67e', '#e8a029', '#8a5309'],
    opacity: 0.4,
    pairs: ['capsule', 'slab', 'cabochon', 'well'],
  },
  {
    id: 'obsidian',
    label: 'Smoked',
    stem:
      'made of smoked obsidian glass, dark and near-black but genuinely ' +
      'transparent, with bright cold specular edges and a deep charcoal ' +
      'body that swallows light',
    tint: ['#59606b', '#262c35', '#0c0f14'],
    opacity: 0.7,
    pairs: ['slab', 'facet', 'capsule', 'frame'],
  },
  {
    id: 'pearl',
    label: 'Pearl',
    stem:
      'finished in nacreous pearl, a soft satin lustre shifting between ' +
      'cream, rose and pale blue-green across the surface, layered ' +
      'iridescence rather than mirror reflection',
    tint: ['#fff4ec', '#ecd9e4', '#c9c2dd'],
    opacity: 0.9,
    pairs: ['cabochon', 'pillow', 'bulb', 'wafer'],
  },
];

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */

export const byId = <T extends { id: string }>(list: T[], id: string): T | undefined =>
  list.find((item) => item.id === id);

/**
 * Build the prompt for one empty container.
 *
 * Order is deliberate: subject, form, material, rig, empty clause. The empty
 * clause goes last because it is the instruction most likely to be dropped,
 * and trailing text survives truncation better than buried text.
 */
export function containerPrompt(form: ContainerForm, material: ContainerMaterial): string {
  return [
    'A single empty 3D icon container,',
    form.stem + ',',
    material.stem + ',',
    LIGHT_RIG + ',',
    EMPTY_CLAUSE + '.',
  ].join(' ');
}

/** The negative prompt that goes with it. Mostly about keeping it empty. */
export const CONTAINER_NEGATIVE =
  'symbol, glyph, letter, text, logo, app icon, face, character, object ' +
  'inside, pictogram, arrow, star, heart, watermark, drop shadow on ' +
  'background, multiple objects, grid of icons, perspective, tilt, ' +
  'off-centre, cropped';

/**
 * A family is one form across many materials, or one material across many
 * forms. Both are coherent; mixing both axes at once is not, and that is the
 * usual reason a generated set fails to read as a set.
 */
export function materialFamily(formId: string, materialIds: string[]) {
  const form = byId(CONTAINER_FORMS, formId);
  if (!form) throw new Error(`Unknown container form: ${formId}`);
  return materialIds.map((id) => {
    const material = byId(CONTAINER_MATERIALS, id);
    if (!material) throw new Error(`Unknown container material: ${id}`);
    return { form, material, prompt: containerPrompt(form, material) };
  });
}

export function formFamily(materialId: string, formIds: string[]) {
  const material = byId(CONTAINER_MATERIALS, materialId);
  if (!material) throw new Error(`Unknown container material: ${materialId}`);
  return formIds.map((id) => {
    const form = byId(CONTAINER_FORMS, id);
    if (!form) throw new Error(`Unknown container form: ${id}`);
    return { form, material, prompt: containerPrompt(form, material) };
  });
}
