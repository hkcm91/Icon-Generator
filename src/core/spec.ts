/**
 * ContainerSpec — the declarative source of truth for icon geometry.
 *
 * The whole point of this file: geometry is DATA, not a prompt. Every number
 * here is honoured exactly by the rasteriser, so a spec that says
 * `radius: 22.5` produces a 22.5% corner on run 1 and on run 10,000.
 *
 * Nothing in this type is ever sent to an image model as a instruction to
 * "please draw a shape with these proportions". Models draw material; code
 * draws geometry.
 */

export type ShapeKind =
  | 'circle'
  | 'rounded-rect'
  | 'superellipse'
  | 'custom-path';

/** Named superellipse exponents for the shapes people actually ask for. */
export const SUPERELLIPSE_PRESETS = {
  /** Pure circle/ellipse. */
  ellipse: 2,
  /** Lamé's original squircle, x^4 + y^4 = r^4. Noticeably plump. */
  squircle: 4,
  /** Closest single-exponent approximation of Apple's icon mask. */
  'ios-icon': 5,
  /** Tighter corners, closer to a soft-cornered square. */
  'soft-square': 8,
} as const;

export type SuperellipsePreset = keyof typeof SUPERELLIPSE_PRESETS;

export interface ContainerSpec {
  /** Spec format version, so saved projects can be migrated safely. */
  version: 1;
  /** Rendered canvas edge length in px. Geometry is resolution-independent. */
  size: number;
  shape: ShapeKind;
  /**
   * Corner radius as a percentage of the inner box edge (0-50).
   * Used by `rounded-rect` only. 50 = fully round.
   */
  radius: number;
  /**
   * Superellipse exponent n in |x/a|^n + |y/b|^n = 1.
   * Used by `superellipse` only. 2 = ellipse, 4 = squircle, higher = squarer.
   */
  exponent: number;
  /** Raw SVG path data in a 0..1000 viewBox. Used by `custom-path` only. */
  customPath: string;
  /** Optical margin as a percentage of `size`, applied on every edge (0-25). */
  padding: number;
  /**
   * Glyph safe-area inset, as a percentage of the inner box (0-40).
   * The glyph is clipped to the container path scaled down by this amount.
   */
  glyphInset: number;
  /** Number of cubic segments used to approximate curved shapes. */
  segments: number;
}

export const DEFAULT_SPEC: ContainerSpec = {
  version: 1,
  size: 1024,
  shape: 'superellipse',
  radius: 24,
  exponent: SUPERELLIPSE_PRESETS['ios-icon'],
  customPath: '',
  padding: 6,
  glyphInset: 18,
  segments: 64,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Coerce arbitrary JSON into a valid spec. Every field is clamped rather than
 * rejected so that a hand-edited file never hard-fails the renderer, and so
 * that two structurally different inputs that mean the same thing normalise to
 * byte-identical specs (which is what makes the determinism hash meaningful).
 */
export function normalizeSpec(input: Partial<ContainerSpec> | null | undefined): ContainerSpec {
  const raw = input ?? {};
  const shape: ShapeKind =
    raw.shape === 'circle' ||
    raw.shape === 'rounded-rect' ||
    raw.shape === 'superellipse' ||
    raw.shape === 'custom-path'
      ? raw.shape
      : DEFAULT_SPEC.shape;

  return {
    version: 1,
    // Even sizes only: an odd canvas puts the shape centre on a half-pixel and
    // makes the two sides of every corner round differently.
    size: Math.round(clamp(Number(raw.size ?? DEFAULT_SPEC.size), 16, 4096) / 2) * 2,
    shape,
    radius: clamp(Number(raw.radius ?? DEFAULT_SPEC.radius), 0, 50),
    exponent: clamp(Number(raw.exponent ?? DEFAULT_SPEC.exponent), 2, 20),
    customPath: typeof raw.customPath === 'string' ? raw.customPath.trim() : '',
    padding: clamp(Number(raw.padding ?? DEFAULT_SPEC.padding), 0, 25),
    glyphInset: clamp(Number(raw.glyphInset ?? DEFAULT_SPEC.glyphInset), 0, 40),
    segments: Math.round(clamp(Number(raw.segments ?? DEFAULT_SPEC.segments), 16, 512)),
  };
}

/** Stable stringify: key order is fixed, so the text is a usable identity. */
export function serializeSpec(spec: ContainerSpec): string {
  const ordered: ContainerSpec = normalizeSpec(spec);
  return JSON.stringify(
    {
      version: ordered.version,
      size: ordered.size,
      shape: ordered.shape,
      radius: ordered.radius,
      exponent: ordered.exponent,
      customPath: ordered.customPath,
      padding: ordered.padding,
      glyphInset: ordered.glyphInset,
      segments: ordered.segments,
    },
    null,
    2,
  );
}
