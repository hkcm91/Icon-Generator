import { describe, expect, it } from 'vitest';
// The same three files LibraryPicker fetches, so a renamed or re-cut
// catalogue fails here rather than leaving the copy quoting a stale number.
import material from '../public/libraries/material-symbols.json';
import brands from '../public/libraries/simple-icons.json';
import y2k from '../public/libraries/y2k-dream.json';
import { TRACKS, tutorialSeconds, type TutorialTrack } from '../src/core/tutorial';
import { MODELS } from '../src/core/replicate';
import { SHAPE_PRESETS } from '../src/core/spec';

const wordsOf = (track: TutorialTrack) =>
  track.scenes.map((scene) => [scene.title, scene.caption, ...scene.points].join(' ')).join(' ');

const track = (id: string) => {
  const found = TRACKS.find((entry) => entry.id === id);
  if (!found) throw new Error(`No track ${id}`);
  return found;
};

const firstIcon = () => wordsOf(track('first-icon'));
const family = () => wordsOf(track('family'));

describe('walkthrough script', () => {
  it('keeps every scene id unique across both tracks', () => {
    // The component resolves a scene's picture from a single id -> component
    // map, so a collision would silently draw the wrong scene.
    const ids = TRACKS.flatMap((entry) => entry.scenes.map((scene) => scene.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(TRACKS.map((entry) => [entry.label, entry] as const))(
    '%s runs in under a minute',
    (_label, entry) => {
      // A recording of a track has to clear the sub-60s bar most places you
      // would post one impose. Adding a scene means taking the time out of the
      // others, not extending the run.
      expect(tutorialSeconds(entry.scenes)).toBeLessThan(60);
    },
  );

  it.each(TRACKS.map((entry) => [entry.label, entry] as const))(
    '%s holds each scene long enough to read',
    (_label, entry) => {
      expect(entry.scenes.length).toBeGreaterThan(0);
      for (const scene of entry.scenes) {
        expect(scene.seconds).toBeGreaterThanOrEqual(5);
        // Three supporting lines is the ceiling; past that it is a document.
        expect(scene.points.length).toBeGreaterThan(0);
        expect(scene.points.length).toBeLessThanOrEqual(3);
      }
    },
  );

  it('names every shape preset the guided view actually offers', () => {
    // Renaming or adding a preset without saying so here would leave the
    // walkthrough describing a row of buttons that no longer exists.
    for (const preset of SHAPE_PRESETS) {
      expect(firstIcon()).toContain(preset.label);
    }
  });

  it('covers the short path, in order', () => {
    const chapters = track('first-icon').scenes.map((scene) => scene.chapter);
    expect(chapters.indexOf('1 · Container')).toBeLessThan(chapters.indexOf('2 · Look'));
    expect(chapters.indexOf('2 · Look')).toBeLessThan(chapters.indexOf('3 · Make one'));
    expect(chapters.indexOf('3 · Make one')).toBeLessThan(chapters.indexOf('4 · Download'));
    expect(firstIcon()).toContain('From my icon');
  });

  it('quotes a glyph count the bundled catalogues actually add up to', () => {
    const total = material.length + brands.length + y2k.length;
    // The copy quotes the round hundred. Re-cutting a catalogue means editing
    // the sentence, not quietly leaving it wrong in either direction.
    expect(family()).toContain((Math.round(total / 100) * 100).toLocaleString('en-US'));
    expect(family()).toContain('three sets');
  });

  it('teaches the batch range the library grid actually clamps to', () => {
    expect(family()).toMatch(/At once/);
    expect(family()).toMatch(/\b1\b[^.]*\b6\b/);
  });

  it('only claims transparency is model-dependent while that is true', () => {
    // The copy says the checkbox greys out on models that do not offer it.
    // That is only honest while the roster is genuinely mixed.
    expect(MODELS.some((model) => model.alpha)).toBe(true);
    expect(MODELS.some((model) => !model.alpha)).toBe(true);
    expect(family()).toContain('Request a real alpha channel');
  });
});
