/**
 * Material prompts for empty icon containers.
 *
 * Two rules learned the hard way, both encoded below:
 *
 * 1. Describe the OPTICS, not the colour. "Absorbing light through its depth
 *    so the centre reads darker than the edges" gets you amber. "Amber
 *    coloured" gets you an orange square. Every stem here says what the light
 *    is doing, because that is the only thing that makes two finishes
 *    genuinely different rather than two hues of the same look.
 *
 * 2. Say it is EMPTY, last. A model asked for "an icon" fills the middle every
 *    single time, and a trailing instruction survives truncation better than a
 *    buried one.
 */

export interface Material {
  id: string;
  label: string;
  /** The material half of the prompt. Surface and optics, never shape. */
  stem: string;
}

/**
 * Repeated verbatim in every prompt.
 *
 * A set whose highlights disagree cannot share one glyph treatment later,
 * because the glyph's own shading has to pick a direction and commit.
 */
export const LIGHT_RIG =
  'lit by one large soft studio softbox from the upper left at 45 degrees, ' +
  'a dim cool fill from the lower right, one crisp specular hit near the ' +
  'upper-left edge, orthographic straight-on view, perfectly centred';

/** Goes last, always. */
export const EMPTY_CLAUSE =
  'the container is completely EMPTY — no symbol, no glyph, no letter, no ' +
  'logo, no face, no object inside or on it, nothing in the centre — an ' +
  'empty vessel only, isolated on a flat neutral grey background';

export const CONTAINER_NEGATIVE =
  'symbol, glyph, letter, text, logo, app icon, face, character, object ' +
  'inside, pictogram, arrow, star, heart, watermark, multiple objects, ' +
  'grid of icons, perspective, tilt, off-centre, cropped';

export const MATERIALS: Material[] = [
  {
    id: 'holo',
    label: 'Holographic foil',
    stem:
      'wrapped in holographic rainbow foil, a metallised film with a fine ' +
      'diffraction grating throwing tight iridescent bands that sweep as the ' +
      'surface turns, saturated magenta cyan lime and gold where the grating ' +
      'catches and bright silver where it does not, high-gloss',
  },
  {
    id: 'soap',
    label: 'Soap film',
    stem:
      'a soap-bubble film stretched across the shape, iridescent interference ' +
      'swirling in slow marbled bands, the film draining and thinning to ' +
      'colourless grey at the top edge and pooling into dense saturated ' +
      'colour at the bottom, extremely thin and fragile',
  },
  {
    id: 'melted-chrome',
    label: 'Melted chrome',
    stem:
      'liquid melted chrome, a soft organic blob of mirror-polished metal ' +
      'that has flowed and set, curvature sweeping the whole environment ' +
      'across its face so a hard horizon line runs right through the middle, ' +
      'a cool bright sky reflected above it and a dark warm floor below, ' +
      'one bright bounce of light along the very bottom edge',
  },
  {
    id: 'chrome',
    label: 'Mirror chrome',
    stem:
      'mirror-polished chrome, fully reflective with no diffuse component, ' +
      'bending a studio environment of a blown-out horizon over a dark floor ' +
      'around its curvature, hard-edged reflections and a razor-thin horizon ' +
      'line compressed into the bevel',
  },
  {
    id: 'oilslick',
    label: 'Oil-slick metal',
    stem:
      'dark polished metal with a thin oil slick over it, near-black mirror ' +
      'reflections overlaid with swirling petrol iridescence in violet, teal ' +
      'and bronze, the colours strongest where the reflection is dimmest',
  },
  {
    id: 'frost',
    label: 'Frosted satin',
    stem:
      'frosted acid-etched glass with a satin finish, light scattering ' +
      'diffusely through a finely pitted surface, no sharp reflection ' +
      'anywhere, only a broad soft bloom of light, visible micro-grain and a ' +
      'milky translucency that deepens toward the middle',
  },
  {
    id: 'opal',
    label: 'Milky opal',
    stem:
      'milky opal glass, semi-translucent with strong subsurface scattering, ' +
      'glowing warm amber where the body is thin at the edges and turning ' +
      'cold dense blue-white through the thick centre, an inner light source ' +
      'rather than a surface reflection',
  },
  {
    id: 'water',
    label: 'Water',
    stem:
      'clear water held in the shape, a trembling meniscus climbing bright at ' +
      'the rim, sharp caustic filaments of focused light webbing across the ' +
      'floor beneath it, cyan in the shallows deepening to blue where the ' +
      'body is thick, genuinely wet',
  },
  {
    id: 'clear',
    label: 'Optical glass',
    stem:
      'colourless optical glass, highly transparent, visibly refracting and ' +
      'displacing whatever sits behind it, splitting into red and blue ' +
      'dispersion fringes where the glass is thickest at the bevel, a faint ' +
      'cool green tint in the body and a bright focused caustic below',
  },
  {
    id: 'jelly',
    label: 'Gummy jelly',
    stem:
      'translucent gummy candy, deeply saturated fruit colour with heavy ' +
      'subsurface scattering so it glows from within where thin, air bubbles ' +
      'trapped at different depths inside the body, a wet tacky sugar-gloss ' +
      'surface',
  },
  {
    id: 'amber',
    label: 'Amber resin',
    stem:
      'cast amber resin, honey-warm and syrupy, absorbing light through its ' +
      'depth so the centre reads far darker than the edges, fine gold glitter ' +
      'and tiny air bubbles suspended at different depths inside, the deep ' +
      'flecks soft and the near ones sharp',
  },
  {
    id: 'pearl',
    label: 'Nacre',
    stem:
      'nacreous mother-of-pearl, a bright cream ground overlaid with soft ' +
      'layered iridescence drifting between rose, mint and pale gold, fine ' +
      'concentric growth banding following the outline, satin lustre rather ' +
      'than mirror reflection',
  },
  {
    id: 'crystal',
    label: 'Cut crystal',
    stem:
      'cut lead crystal with flat polished facets meeting at hard edges, each ' +
      'facet catching a completely different value with no gradient between ' +
      'them, prismatic rainbow dispersion firing along the facet joins, ' +
      'brilliant and hard-edged',
  },
  {
    id: 'vinyl',
    label: 'Matte vinyl',
    stem:
      'soft-touch matte vinyl, completely opaque and slightly rubbery, a ' +
      'powdery bloom on the surface, absolutely no specular reflection, only ' +
      'a wide gradual terminator from lit to shadowed and a faint velvety ' +
      'sheen where light grazes the rim',
  },
  {
    id: 'aqua',
    label: 'Aqua gel',
    stem:
      'a glossy Aqua-style gel button, a hard-edged white gloss cap filling ' +
      'the top half with a crisp lower boundary, a deeply saturated candy ' +
      'body beneath it, and a bright bounce of light returning up through the ' +
      'bottom edge, early-2000s pinstripe-era gloss',
  },
];

export const byId = (id: string): Material | undefined =>
  MATERIALS.find((m) => m.id === id);

/**
 * Build the prompt for one empty container.
 *
 * `shape` describes the vessel — pass whatever geometry you are generating.
 * Order matters: subject, shape, material, rig, empty clause.
 */
export function containerPrompt(material: Material, shape: string): string {
  return [
    'A single empty 3D icon container,',
    shape + ',',
    material.stem + ',',
    LIGHT_RIG + ',',
    EMPTY_CLAUSE + '.',
  ].join(' ');
}
