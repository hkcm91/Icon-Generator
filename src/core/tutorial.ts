/**
 * The walkthrough script.
 *
 * Kept here, as data, for the same reason the geometry is: it is the thing
 * that has to stay true as the app changes, and a paragraph buried in JSX is
 * not reviewable. The component supplies a picture per scene; this file
 * supplies every word and how long it stays up.
 *
 * Two tracks, because there are two different questions. **First icon** is
 * for someone who has never seen the app: the shortest path from a master
 * they already have to a downloaded set, and nothing else. **Making a
 * family** is for someone already using it: the handful of controls that
 * come up once you are working at volume — the glyph library, batch size,
 * redoing a bad card, and what to do when a symbol comes back on a solid
 * block.
 *
 * The editorial rule for both: only what someone actually needs. Sliders,
 * conditioning modes, the determinism check and the measurement tools are
 * deliberately absent — they live behind "All controls" and nobody needs
 * them to finish the job.
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

export interface TutorialTrack {
  id: string;
  /** Switcher label. */
  label: string;
  /** One line on who this track is for. */
  blurb: string;
  scenes: TutorialScene[];
}

const FIRST_ICON: TutorialScene[] = [
  {
    id: 'start',
    chapter: 'Start',
    title: 'One icon in, a whole set out.',
    caption:
      'The short path is five steps, and the first one does most of the work. Everything else in this app is optional.',
    points: [
      'Give it the master icon you already approved',
      'Say what it should be made of',
      'Download every platform size at once',
    ],
    seconds: 6,
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
    seconds: 7,
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
    seconds: 8,
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
    seconds: 7,
  },
  {
    id: 'one',
    chapter: '3 · Make one',
    title: 'Generate one before you commit.',
    caption:
      'A single icon is the cheap way to check the look. Like it, carry on; do not, change a word and press it again.',
    points: ['One generation, a few seconds', 'The container is already exact — only the material is in question'],
    seconds: 5,
  },
  {
    id: 'download',
    chapter: '4 · Download',
    title: 'Download every size in one go.',
    caption:
      'iOS, Android, macOS, Windows and web, plus a .ico and the shape spec, as a single zip.',
    points: ['Every size is rendered fresh from the path, not shrunk down from one big master'],
    seconds: 6,
  },
  {
    id: 'done',
    chapter: 'Done',
    title: 'That is a full set out.',
    caption:
      'All controls holds the geometry sliders, the determinism check and the measurement tools. You never need them for this.',
    points: [
      'Making a family — the other track — covers glyphs, batching and transparency',
      'Reopen either any time — Tutorial, top right',
    ],
    seconds: 6,
  },
];

const FAMILY: TutorialScene[] = [
  {
    id: 'library',
    chapter: '1 · Glyphs',
    title: 'Add the symbols the family needs.',
    caption:
      'Browse glyphs opens 7,400 built-in names across three sets. Search, tick the ones you want, add them in one go.',
    points: [
      'Material Symbols, brand marks, and the Y2K Dream set',
      'Search matches the name, the category and the keywords',
      'Add all matching takes every hit at once — or import a CSV, JSON or one name per line',
    ],
    seconds: 8,
  },
  {
    id: 'batch',
    chapter: '2 · Batch',
    title: 'Generate them one at a time — or six.',
    caption:
      'Select the cards you want and set At once. It is a bounded pool, so the rest queue rather than all firing together.',
    points: [
      '1 is gentle on your rate limit, 6 is fastest, 3 is a good default',
      'Stop halts the queue and keeps every card that already finished',
      'Cards deselect as they succeed, so Generate selected always means what is left',
    ],
    seconds: 8,
  },
  {
    id: 'redo',
    chapter: '3 · Fix',
    title: 'Redo just the ones that came out wrong.',
    caption:
      'Every card carries its own button and its own version. A card that fails does not take the batch down with it.',
    points: [
      'Redo re-rolls one card and bumps it to v2',
      'A failed card keeps its error and stays selected for the next run',
    ],
    seconds: 6,
  },
  {
    id: 'alpha',
    chapter: '4 · Transparency',
    title: 'When a symbol comes back on a solid block.',
    caption:
      'Image models ignore "transparent background" constantly, so the app keys the flat background out itself — corners sampled, dominant colour removed.',
    points: [
      'That happens automatically; usually you never see it',
      'All controls → Request a real alpha channel asks the model directly instead',
      'Only some models offer it — the checkbox greys out on the ones that do not',
    ],
    seconds: 8,
  },
  {
    id: 'keep',
    chapter: '5 · Keep',
    title: 'Your renders survive a refresh.',
    caption:
      'Finished cards are stored as image blobs, not in the project file, so a family of several hundred comes back intact.',
    points: [
      'Close the tab and pick the same family up later',
      'A card whose image did not survive admits it and asks to be remade',
    ],
    seconds: 6,
  },
];

export const TRACKS: TutorialTrack[] = [
  {
    id: 'first-icon',
    label: 'Your first icon',
    blurb: 'The short path: a master you already have, out as a full set.',
    scenes: FIRST_ICON,
  },
  {
    id: 'family',
    label: 'Making a family',
    blurb: 'Working at volume: glyphs, batch size, redoing, transparency.',
    scenes: FAMILY,
  },
];

/** Total runtime of a track if nobody touches anything. */
export function tutorialSeconds(scenes: TutorialScene[]): number {
  return scenes.reduce((total, scene) => total + scene.seconds, 0);
}
