import { beforeEach, describe, expect, it } from 'vitest';
import { buildCodexJob, codexOutputMode, matchCodexResultFile } from '../src/core/codexLocal';
import { makeItem, resetIdCounter } from '../src/core/library';
import { DEFAULT_SPEC } from '../src/core/spec';
import type { GenerationOptions } from '../src/state/useGeneration';

const options: Omit<GenerationOptions, 'glyphSubject'> = {
  spec: DEFAULT_SPEC,
  model: 'openai/gpt-image-2',
  material: 'iridescent glass',
  glyphStyle: '',
  conditioning: 'auto',
  wantAlpha: false,
  theme: 'restrained Halloween or fall, one treatment per icon',
  familyPrompt: 'dark oilslick frame and pearly subject',
  negativePrompt: 'busy repeated decorations',
  styleProfile: 'soft studio light, dimensional glass',
  subjectStyleProfile: 'icy pearl',
  frameStyleProfile: 'thick dark glass rim',
  styleFidelity: 92,
  detailVariation: 65,
  quality: 'low',
};

beforeEach(() => resetIdCounter());

describe('local Codex generation jobs', () => {
  it('creates deterministic result filenames and complete-tile prompts', () => {
    const item = makeItem('Instagram', { concept: 'Instagram camera mark' });
    const job = buildCodexJob(
      'Oilslick Halloween',
      [item],
      'filled',
      options,
      [{ name: 'Master', role: 'master', dataUrl: 'data:image/png;base64,abc' }],
      '2026-08-26T20:00:00.000Z',
    );

    expect(job).toMatchObject({
      version: 1,
      createdAt: '2026-08-26T20:00:00.000Z',
      familyName: 'Oilslick Halloween',
      construction: 'filled',
    });
    expect(job.cards[0]).toMatchObject({
      id: item.id,
      name: 'Instagram',
      subject: 'Instagram camera mark',
      outputMode: 'complete',
      nextRevision: 1,
      outputFile: `results/${item.id}.png`,
    });
    expect(job.cards[0].prompt).toContain('include the family container');
    expect(job.cards[0].prompt).toContain('Never copy their old subject');
    expect(job.cards[0].prompt).toContain('Return exactly one 1024×1024 PNG');
    expect(job.references).toHaveLength(1);
  });

  it('requests only a transparent subject when the app owns the open frame', () => {
    const item = makeItem('Search', { directorInstruction: 'make the magnifier simpler' });
    const job = buildCodexJob('Glass', [item], 'open-frame', options, []);

    expect(codexOutputMode('open-frame')).toBe('framed');
    expect(job.cards[0].outputMode).toBe('framed');
    expect(job.cards[0].prompt).toContain('Generate only the isolated subject');
    expect(job.cards[0].prompt).toContain('the app will place the approved frame around it');
    expect(job.cards[0].prompt).toContain('make the magnifier simpler');
  });

  it('matches exact card ids and only unambiguous friendly filenames', () => {
    const first = makeItem('Google Maps');
    const second = makeItem('Google Maps');
    const unique = makeItem('Instagram');
    const items = [first, second, unique];

    expect(matchCodexResultFile(`${first.id}.png`, items)).toBe(first);
    expect(matchCodexResultFile(`${unique.id}--instagram.webp`, items)).toBe(unique);
    expect(matchCodexResultFile('instagram.png', items)).toBe(unique);
    expect(matchCodexResultFile('google-maps.png', items)).toBeNull();
    expect(matchCodexResultFile('unrelated.png', items)).toBeNull();
  });
});
