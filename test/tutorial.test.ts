import { describe, expect, it } from 'vitest';
import { TUTORIAL, tutorialSeconds } from '../src/core/tutorial';
import { SHAPE_PRESETS } from '../src/core/spec';

const words = TUTORIAL.map((scene) =>
  [scene.title, scene.caption, ...scene.points].join(' '),
).join(' ');

describe('walkthrough script', () => {
  it('gives every scene a unique id', () => {
    expect(new Set(TUTORIAL.map((scene) => scene.id)).size).toBe(TUTORIAL.length);
  });

  it('runs in under a minute', () => {
    // The brief was "quick", and a recording of it has to clear the sub-60s
    // bar that most places you would post one impose. Adding a scene means
    // taking the time out of the others, not extending the run.
    expect(tutorialSeconds()).toBeLessThan(60);
  });

  it('holds each scene long enough to read', () => {
    for (const scene of TUTORIAL) {
      expect(scene.seconds).toBeGreaterThanOrEqual(5);
      // Three supporting lines is the ceiling; past that it is a document.
      expect(scene.points.length).toBeLessThanOrEqual(3);
      expect(scene.points.length).toBeGreaterThan(0);
    }
  });

  it('names every shape preset the guided view actually offers', () => {
    // Renaming or adding a preset without saying so here would leave the
    // walkthrough describing a row of buttons that no longer exists.
    for (const preset of SHAPE_PRESETS) {
      expect(words).toContain(preset.label);
    }
  });

  it('covers the whole minimum path, in order', () => {
    const chapters = TUTORIAL.map((scene) => scene.chapter);
    expect(chapters.indexOf('1 · Container')).toBeLessThan(chapters.indexOf('2 · Look'));
    expect(chapters.indexOf('2 · Look')).toBeLessThan(chapters.indexOf('3 · Make one'));
    expect(chapters.indexOf('3 · Make one')).toBeLessThan(chapters.indexOf('4 · Family'));
    expect(chapters.indexOf('4 · Family')).toBeLessThan(chapters.indexOf('5 · Download'));
  });

  it('teaches the upload path and the batch size, which is the point of it', () => {
    expect(words).toContain('From my icon');
    expect(words).toMatch(/At once/);
    // 1..6 is the range the library grid clamps to.
    expect(words).toMatch(/\b1\b[^.]*\b6\b/);
  });
});
