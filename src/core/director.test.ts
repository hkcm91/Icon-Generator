import { describe, expect, it } from 'vitest';
import { stageDirectorInstruction, type DirectorContext } from './director';

const context: DirectorContext = {
  familyName: 'Aqua Shaker',
  material: 'clear glass',
  familyPrompt: 'Keep the clear glass frame.',
  negativePrompt: 'No black border.',
  styleProfile: 'aqua shaker',
  subjectStyleProfile: 'pearly glass',
  frameStyleProfile: 'clear squircle',
  containerMode: 'filled',
  styleFidelity: 100,
  detailVariation: 60,
  glyphScale: 1,
  theme: '',
  estimatedImageCost: 0.012,
  cards: [
    {
      name: 'Mail',
      concept: 'envelope',
      status: 'draft',
      selected: true,
      themeTreatment: '',
      directorInstruction: '',
    },
  ],
};

describe('stageDirectorInstruction', () => {
  it('returns a visible reply for an ordinary family direction', () => {
    const result = stageDirectorInstruction('Make the glass a little clearer', context, '');

    expect(result.reply).toBe('Using that direction for this family.');
    expect(result.reply.trim()).not.toBe('');
    expect(result.action).toBeUndefined();
  });

  it('returns a scoped reply when the instruction targets a card', () => {
    const result = stageDirectorInstruction('Make Mail more minimal', context, '');

    expect(result.reply).toBe('Updated Mail.');
    expect(result.patch.selection).toEqual({ mode: 'named', names: ['Mail'] });
  });

  it.each([
    'can you please start filling the cards? add variety with the filler placements',
    'implement',
    'go',
  ])('treats “%s” as a request to generate selected cards', (instruction) => {
    const result = stageDirectorInstruction(instruction, context, '');

    expect(result.action).toBe('generate-selected');
    expect(result.reply).toBe('Generation requested for 1 selected card.');
  });
});
