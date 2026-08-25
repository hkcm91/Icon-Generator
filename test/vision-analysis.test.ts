import { describe, expect, it } from 'vitest';
import { parseReferenceAnalysis } from '../src/core/vision';

describe('reference analysis', () => {
  it('separates source content, transferable style and theme concepts', () => {
    const result = parseReferenceAnalysis(`Here is the result:\n\`\`\`json
      {"subject":"ghost","style":"pastel iridescent 3D rendering","subjectStyle":"milky opalescent filled volume with broad highlights","frameStyle":"clear hollow ribbons and bubbles","construction":"open-frame-with-subject","themes":[
        {"name":"Halloween","rationale":"The ghost is seasonal","subjects":["pumpkin","scarecrow","cauldron"]},
        {"name":"Y2K spectral","rationale":"Iridescent gel finish","subjects":["flip phone","CD","star"]}
      ]}\n\`\`\``);
    expect(result.subject).toBe('ghost');
    expect(result.style).toContain('iridescent 3D');
    expect(result.subjectStyle).toContain('filled volume');
    expect(result.frameStyle).toContain('hollow ribbons');
    expect(result.themes[0].name).toBe('Halloween');
    expect(result.themes[0].subjects).toEqual(['pumpkin', 'scarecrow', 'cauldron']);
    expect(result.construction).toBe('open-frame-with-subject');
  });

  it('fails closed when a model returns malformed JSON', () => {
    expect(parseReferenceAnalysis('not useful')).toEqual({
      subject: 'not useful',
      style: '',
      subjectStyle: '',
      frameStyle: '',
      themes: [],
      construction: 'unknown',
    });
  });
});
