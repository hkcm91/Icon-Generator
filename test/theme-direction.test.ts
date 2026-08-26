import { describe, expect, it } from 'vitest';
import { automaticThemeTreatment, themeAlternatives, themeRestraintPrompt } from '../src/core/themeDirection';

describe('restrained family theme direction', () => {
  it('treats slash and or themes as alternatives', () => {
    expect(themeAlternatives('Halloween / Fall')).toEqual(['Halloween', 'Fall']);
    expect(themeAlternatives('winter or spring')).toEqual(['winter', 'spring']);
  });

  it('balances one theme lane per icon and keeps its treatment stable', () => {
    const first = automaticThemeTreatment('Halloween/Fall', 'home-1', 0);
    const second = automaticThemeTreatment('Halloween/Fall', 'menu-2', 1);
    expect(first).toContain("Halloween as this icon's only theme lane");
    expect(first).toContain('Do not combine it with Fall cues');
    expect(second).toContain("Fall as this icon's only theme lane");
    expect(automaticThemeTreatment('Halloween/Fall', 'home-1', 0)).toBe(first);
  });

  it('places a hard one-cue clutter budget after conversational direction', () => {
    const prompt = themeRestraintPrompt('Halloween/Fall', 'Use Halloween only.');
    expect(prompt).toContain('alternatives');
    expect(prompt).toContain('Use at most one integrated theme cue');
    expect(prompt).toContain('clear negative space');
    expect(prompt).toContain('shared container, material, camera, lighting, and edge construction stay consistent');
  });
});
