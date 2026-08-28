import { describe, expect, it } from 'vitest';
import {
  CONTAINER_FORMS,
  CONTAINER_MATERIALS,
  EMPTY_CLAUSE,
  LAYER_ORDER,
  containerPrompt,
  formFamily,
  materialFamily,
} from '../src/core/containers';
import { normalizeSpec } from '../src/core/spec';

const ids = (list: Array<{ id: string }>) => list.map((entry) => entry.id);

describe('the container catalogue', () => {
  it('has unique form and material ids', () => {
    expect(new Set(ids(CONTAINER_FORMS)).size).toBe(CONTAINER_FORMS.length);
    expect(new Set(ids(CONTAINER_MATERIALS)).size).toBe(CONTAINER_MATERIALS.length);
  });

  it('puts the glyph between the body and the specular pass', () => {
    // This ordering is the entire reason a composited glyph reads as being
    // inside the glass rather than stuck on top of it. If it ever changes,
    // the composites go flat.
    const glyph = LAYER_ORDER.indexOf('glyph');
    expect(LAYER_ORDER.indexOf('back')).toBeLessThan(glyph);
    expect(glyph).toBeLessThan(LAYER_ORDER.indexOf('body'));
    expect(glyph).toBeLessThan(LAYER_ORDER.indexOf('specular'));
  });

  it('every geometry patch survives spec normalisation unchanged', () => {
    // A patch that gets clamped would silently give a different silhouette
    // from the one the form describes, which breaks the family.
    for (const form of CONTAINER_FORMS) {
      const normalised = normalizeSpec(form.spec);
      for (const [key, value] of Object.entries(form.spec)) {
        expect({ [form.id]: { [key]: normalised[key as keyof typeof normalised] } }).toEqual({
          [form.id]: { [key]: value },
        });
      }
    }
  });

  it('ends every prompt with the empty clause', () => {
    // Models fill empty containers unless told not to, and the instruction
    // has to be last to survive prompt truncation.
    for (const form of CONTAINER_FORMS) {
      for (const material of CONTAINER_MATERIALS) {
        expect(containerPrompt(form, material)).toContain(EMPTY_CLAUSE);
        expect(containerPrompt(form, material).endsWith(EMPTY_CLAUSE + '.')).toBe(true);
      }
    }
  });

  it('never mentions a glyph, symbol or logo as something to draw', () => {
    for (const form of CONTAINER_FORMS) {
      expect(form.stem).not.toMatch(/\b(glyph|symbol|logo|icon)\b/i);
    }
    for (const material of CONTAINER_MATERIALS) {
      expect(material.stem).not.toMatch(/\b(glyph|symbol|logo|icon)\b/i);
    }
  });

  it('keeps slot and split values inside their stated ranges', () => {
    for (const form of CONTAINER_FORMS) {
      const { depth, refract, fringe, scale } = form.slot;
      for (const value of [depth, refract, fringe]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(scale).toBeGreaterThan(0);
      expect(form.split.specularCut).toBeGreaterThan(0.5);
      expect(form.split.specularCut).toBeLessThan(1);
    }
  });

  it('only names real forms in a material pairing', () => {
    const formIds = new Set(ids(CONTAINER_FORMS));
    for (const material of CONTAINER_MATERIALS) {
      for (const pair of material.pairs) expect(formIds).toContain(pair);
    }
  });

  it('builds a family along one axis at a time', () => {
    const byMaterial = materialFamily('cabochon', ['holo', 'jelly']);
    expect(byMaterial).toHaveLength(2);
    expect(new Set(byMaterial.map((entry) => entry.form.id)).size).toBe(1);

    const byForm = formFamily('holo', ['cabochon', 'wafer', 'frame']);
    expect(byForm).toHaveLength(3);
    expect(new Set(byForm.map((entry) => entry.material.id)).size).toBe(1);
  });

  it('refuses an unknown member rather than silently dropping it', () => {
    expect(() => materialFamily('nope', ['clear'])).toThrow(/nope/);
    expect(() => formFamily('clear', ['nope'])).toThrow(/nope/);
  });
});
