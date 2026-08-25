import { describe, expect, it } from 'vitest';
// The serverless API is deliberately plain JS because Vercel runs it directly.
// @ts-expect-error There is no declaration file for this server-only module.
import { clampFrontIconCost } from '../api/generate.js';

describe('Front Icon server cost guard', () => {
  it('overrides stale GPT High and multiple-output requests', () => {
    expect(clampFrontIconCost('openai/gpt-image-2', {
      prompt: 'moon',
      quality: 'high',
      number_of_images: 4,
    })).toMatchObject({
      prompt: 'moon',
      quality: 'low',
      number_of_images: 1,
    });
  });

  it('does not rewrite another provider input', () => {
    expect(clampFrontIconCost('bytedance/seedream-4', { size: '2K' })).toEqual({ size: '2K' });
  });
});
