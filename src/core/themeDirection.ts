import { hashString } from './hash';

/** A slash, pipe, or the word "or" means alternatives—not ingredients. */
export function themeAlternatives(theme: string): string[] {
  const seen = new Set<string>();
  return theme
    .split(/\s*(?:\/|\||\bor\b)\s*/i)
    .map((part) => part.trim().replace(/[.,;:]+$/, ''))
    .filter((part) => {
      const key = part.toLocaleLowerCase();
      if (!part || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const CUE_STRATEGIES = [
  'Express that lane through one integrated silhouette or shape detail; add no separate seasonal props.',
  'Express that lane through restrained material, palette, or lighting treatment; add no extra seasonal object.',
  'Use exactly one small attached seasonal accent and keep every other surface quiet.',
] as const;

/**
 * Give every card a stable, restrained theme lane without another model call.
 * Family order balances alternatives; the id varies how the single cue is used.
 */
export function automaticThemeTreatment(theme: string, identity: string, familyIndex: number): string {
  const alternatives = themeAlternatives(theme);
  if (!alternatives.length) return '';
  const lane = alternatives[Math.abs(familyIndex) % alternatives.length];
  const hash = Number.parseInt(hashString(identity).slice(0, 8), 16) >>> 0;
  const strategy = CUE_STRATEGIES[hash % CUE_STRATEGIES.length];
  const excluded = alternatives.filter((candidate) => candidate !== lane);
  return [
    `Use ${lane} as this icon's only theme lane.`,
    excluded.length ? `Do not combine it with ${excluded.join(' or ')} cues on this icon.` : '',
    strategy,
  ].filter(Boolean).join(' ');
}

/** Final prompt guardrail, deliberately placed after natural-language direction. */
export function themeRestraintPrompt(theme = '', treatment = ''): string {
  if (!theme.trim() && !treatment.trim()) return '';
  const alternatives = themeAlternatives(theme);
  return [
    'THEME RESTRAINT — HIGHEST PRIORITY:',
    alternatives.length > 1
      ? `The theme phrase “${theme.trim()}” contains alternatives. Use only one alternative on this icon; never combine them as a checklist.`
      : theme.trim() ? `Keep this icon in the ${theme.trim()} family.` : '',
    treatment.trim(),
    'Use at most one integrated theme cue. Keep the functional subject dominant and instantly readable at 24px.',
    'Keep broad quiet surfaces and clear negative space. Do not scatter seasonal props, repeat a motif around the rim, build a background scene, or add decorative filler.',
    'The shared container, material, camera, lighting, and edge construction stay consistent; thematic cues may vary without changing those family invariants.',
  ].filter(Boolean).join(' ');
}
