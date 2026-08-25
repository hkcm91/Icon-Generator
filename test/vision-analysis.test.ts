import { describe, expect, it } from 'vitest';
import { parseReferenceAnalysis } from '../src/core/vision';

describe('reference analysis', () => {
  it('separates source content, transferable style and theme concepts', () => {
    const result = parseReferenceAnalysis(`Here is the result:\n\`\`\`json
      {"subject":"ghost","style":"translucent iridescent gel with pastel reflections","themes":[
        {"name":"Halloween","rationale":"The ghost is seasonal","subjects":["pumpkin","scarecrow","cauldron"]},
        {"name":"Y2K spectral","rationale":"Iridescent gel finish","subjects":["flip phone","CD","star"]}
      ]}\n\`\`\``);
    expect(result.subject).toBe('ghost');
    expect(result.style).toContain('iridescent gel');
    expect(result.themes[0].name).toBe('Halloween');
    expect(result.themes[0].subjects).toEqual(['pumpkin', 'scarecrow', 'cauldron']);
  });

  it('fails closed when a model returns malformed JSON', () => {
    expect(parseReferenceAnalysis('not useful')).toEqual({
      subject: 'not useful',
      style: '',
      themes: [],
    });
  });
});
