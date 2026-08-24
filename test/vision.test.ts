import { describe, expect, it } from 'vitest';
import { cleanSymbolAnswer } from '../src/core/vision';

describe('cleaning a caption model answer', () => {
  it('keeps a bare noun phrase', () => {
    expect(cleanSymbolAnswer('a paper plane')).toBe('a paper plane');
  });

  it('strips the scaffolding caption models wrap answers in', () => {
    // Left in, this would ask the image model to draw a sentence about a plane.
    expect(cleanSymbolAnswer('The symbol in the image is a paper plane.')).toBe('a paper plane');
    expect(cleanSymbolAnswer('The icon appears to be a gear')).toBe('a gear');
    expect(cleanSymbolAnswer('It shows two overlapping speech bubbles')).toBe(
      'two overlapping speech bubbles',
    );
  });

  it('strips quotes and trailing punctuation', () => {
    expect(cleanSymbolAnswer('"a gear."')).toBe('a gear');
    expect(cleanSymbolAnswer("'a camera'")).toBe('a camera');
  });

  it('takes only the first line', () => {
    expect(cleanSymbolAnswer('a compass\n\nIt is centred on a blue background.')).toBe('a compass');
  });

  it('returns nothing when the model reports no symbol', () => {
    expect(cleanSymbolAnswer('none')).toBe('');
    expect(cleanSymbolAnswer('None.')).toBe('');
  });

  it('rejects a rambling answer rather than passing noise into the prompt', () => {
    const rambling =
      'This appears to be some kind of rounded application icon with a lot of detail and colour';
    expect(cleanSymbolAnswer(rambling)).toBe('');
  });

  it('handles an empty or whitespace reply', () => {
    expect(cleanSymbolAnswer('')).toBe('');
    expect(cleanSymbolAnswer('   \n  ')).toBe('');
  });
});
