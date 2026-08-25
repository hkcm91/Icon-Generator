/**
 * The walkthrough script.
 *
 * Kept here, as data, for the same reason the geometry is: it is the thing
 * that has to stay true as the app changes, and a paragraph buried in JSX is
 * not reviewable. The component supplies a picture per scene; this file
 * supplies every word and how long it stays up.
 *
 * The editorial rule for what belongs here: **the shortest path from a master
 * icon you already have to a downloaded set.** Sliders, conditioning modes,
 * the determinism check and the measurement tools are all deliberately absent
 * — they live behind "All controls" and nobody needs them to finish the job.
 */

export interface TutorialScene {
  /** Stable id; the component keys its animation off this. */
  id: string;
  /** Short label for the chapter rail. */
  chapter: string;
  title: string;
  /** One sentence, readable in the time the scene is up. */
  caption: string;
  /** At most three supporting lines. */
  points: string[];
  /** How long the scene holds before auto-advancing. */
  seconds: number;
}

export const TUTORIAL: TutorialScene[] = [
  {
    id: 'start',
    chapter: 'Start',
    title: 'One icon in, a whole set out.',
    caption:
      'The short path is five steps, and the first one does most of the work. Everything else in this app is optional.',
    points: [
      'Give it the master icon you already approved',
      'Pick the symbols the rest of the family needs',
      'Download every platform size at once',
    ],
    seconds: 7,
  },
  {
    id: 'container',
    chapter: '1 · Container',
    title: 'Start from your icon — or pick a shape.',
    caption:
      'Already have a master? From my icon is the whole of step 1. Starting fresh? Take one of the four shapes.',
    points: [
      'From my icon — upload the PNG you already like',
      'Or Squircle, Rounded, Circle, Square',
      'The outline is compiled from a spec, so it cannot drift between runs',
    ],
    seconds: 8,
  },
  {
    id: 'read',
    chapter: '1 · Container',
    title: 'That one upload fills in the rest.',
    caption:
      'The outline is traced from your pixels, the palette is measured, and a vision model names the symbol it finds.',
    points: [
      'Corner curve traced — no slider to guess at',
      'Base colour and surface wording read off the image',
      'Your master rides along with every generation, so the family matches it',
    ],
    seconds: 9,
  },
  {
    id: 'describe',
    chapter: '2 · Look',
    title: 'Two plain-English fields, already filled in.',
    caption:
      'This is where you steer the AI. Change a word, get a different material — you are writing a sentence, not setting a parameter.',
    points: [
      'Surface — what the tile is made of',
      'Symbol — what sits on it. Leave it empty for a plain tile.',
      'Everything the upload guessed stays editable',
    ],
    seconds: 8,
  },
  {
    id: 'one',
    chapter: '3 · Make one',
    title: 'Generate one before you commit.',
    caption:
      'A single icon is the cheap way to check the look. Like it, carry on; do not, change a word and press it again.',
    points: ['One generation, a few seconds', 'The container is already exact — only the material is in question'],
    seconds: 6,
  },
  {
    id: 'family',
    chapter: '4 · Family',
    title: 'Then make the whole family.',
    caption:
      'Pick your symbols, say how many should run at once, and let the batch go.',
    points: [
      'Browse glyphs — 7,400 built in, or import your own list',
      'At once: 1 is gentle on your rate limit, 6 is fastest, 3 is a good default',
      'Any card that came out wrong has its own Redo',
    ],
    seconds: 9,
  },
  {
    id: 'download',
    chapter: '5 · Download',
    title: 'Download every size in one go.',
    caption:
      'iOS, Android, macOS, Windows and web, plus a .ico and the shape spec, as a single zip.',
    points: ['Every size is rendered fresh from the path, not shrunk down from one big master'],
    seconds: 7,
  },
  {
    id: 'done',
    chapter: 'Done',
    title: 'That is the whole job.',
    caption:
      'All controls holds the geometry sliders, the determinism check and the measurement tools. You never need them to get a set out.',
    points: ['Reopen this walkthrough any time — Tutorial, top right'],
    seconds: 7,
  },
];

/** Total runtime if nobody touches anything. */
export function tutorialSeconds(scenes: TutorialScene[] = TUTORIAL): number {
  return scenes.reduce((total, scene) => total + scene.seconds, 0);
}
