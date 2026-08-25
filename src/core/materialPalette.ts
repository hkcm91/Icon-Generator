import type { Swatch } from './describe';

export type MaterialRole = 'base' | 'glyph' | 'frame' | 'accent';
export type MaterialConstruction = 'filled-container' | 'open-frame-with-subject' | 'isolated-subject' | 'unknown';

export interface MaterialRecipe {
  role: MaterialRole;
  name: string;
  description: string;
}

export interface MaterialPalette {
  /** Measured directly from the uploaded pixels, never hallucinated. */
  colors: Array<Pick<Swatch, 'hex' | 'name' | 'weight'>>;
  /** Texture recipes inferred once, then reused across the whole family. */
  recipes: MaterialRecipe[];
}

export function normalizeMaterialPalette(value: unknown): MaterialPalette | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { colors?: unknown; recipes?: unknown };
  const roles = new Set<MaterialRole>(['base', 'glyph', 'frame', 'accent']);
  const colors = Array.isArray(raw.colors) ? raw.colors.slice(0, 5).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const color = entry as Record<string, unknown>;
    const hex = typeof color.hex === 'string' ? color.hex.toLowerCase() : '';
    if (!/^#[0-9a-f]{6}$/.test(hex)) return [];
    const weight = Number(color.weight);
    return [{
      hex,
      name: typeof color.name === 'string' ? color.name.trim().slice(0, 80) : hex,
      weight: Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0,
    }];
  }) : [];
  const seen = new Set<MaterialRole>();
  const recipes = Array.isArray(raw.recipes) ? raw.recipes.slice(0, 8).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const recipe = entry as Record<string, unknown>;
    const role = recipe.role as MaterialRole;
    const description = typeof recipe.description === 'string' ? recipe.description.trim().slice(0, 700) : '';
    if (!roles.has(role) || seen.has(role) || !description) return [];
    seen.add(role);
    return [{
      role,
      name: typeof recipe.name === 'string' && recipe.name.trim()
        ? recipe.name.trim().slice(0, 80)
        : `${role} material`,
      description,
    }];
  }) : [];
  return colors.length || recipes.length ? { colors, recipes } : null;
}

const label: Record<MaterialRole, string> = {
  base: 'Base',
  glyph: 'Glyph',
  frame: 'Frame',
  accent: 'Accent',
};

export function materialPalettePrompt(palette?: MaterialPalette | null): string {
  if (!palette?.recipes.length) return '';
  const recipes = palette.recipes
    .map((recipe) => `${label[recipe.role]} material — ${recipe.name}: ${recipe.description}`)
    .join(' | ');
  const colors = palette.colors.map((color) => `${color.name} ${color.hex}`).join(', ');
  return `APPROVED MATERIAL PALETTE: ${recipes}${colors ? `. Measured colors: ${colors}.` : ''} Apply each material only to its named role; do not swap the translucent frame treatment onto the glyph or the filled glyph treatment onto the frame.`;
}

export function mergeMaterialPalette(
  colors: Array<Pick<Swatch, 'hex' | 'name' | 'weight'>>,
  recipes: MaterialRecipe[],
  fallback: { base: string; glyph: string; frame: string },
  construction: MaterialConstruction = 'unknown',
): MaterialPalette {
  const allowed = construction === 'open-frame-with-subject'
    ? new Set<MaterialRole>(['glyph', 'frame', 'accent'])
    : construction === 'isolated-subject'
      ? new Set<MaterialRole>(['glyph', 'accent'])
      : new Set<MaterialRole>(['base', 'glyph', 'frame', 'accent']);
  const byRole = new Map<MaterialRole, MaterialRecipe>();
  for (const recipe of recipes) {
    if (!allowed.has(recipe.role) || !recipe.description.trim() || byRole.has(recipe.role)) continue;
    byRole.set(recipe.role, recipe);
  }
  if (allowed.has('base') && !byRole.has('base') && fallback.base.trim()) {
    byRole.set('base', { role: 'base', name: 'Container surface', description: fallback.base.trim() });
  }
  if (allowed.has('glyph') && !byRole.has('glyph') && fallback.glyph.trim()) {
    byRole.set('glyph', { role: 'glyph', name: 'Symbol material', description: fallback.glyph.trim() });
  }
  if (allowed.has('frame') && !byRole.has('frame') && fallback.frame.trim()) {
    byRole.set('frame', { role: 'frame', name: 'Decorative frame', description: fallback.frame.trim() });
  }
  const order: MaterialRole[] = ['base', 'glyph', 'frame', 'accent'];
  return {
    colors: colors.slice(0, 5).map(({ hex, name, weight }) => ({ hex, name, weight })),
    recipes: order.flatMap((role) => byRole.has(role) ? [byRole.get(role)!] : []),
  };
}
