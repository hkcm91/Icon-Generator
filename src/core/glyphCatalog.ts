export type GlyphCatalogId = 'material' | 'y2k' | 'brands';

export interface GlyphCatalogEntry {
  name: string;
  slug?: string;
  concept?: string;
  category?: string;
  keywords?: string[];
}

export interface GlyphSection {
  id: string;
  label: string;
  description: string;
  matches: (entry: GlyphCatalogEntry) => boolean;
}

const normalized = (entry: GlyphCatalogEntry) =>
  `${entry.name} ${entry.slug ?? ''} ${entry.category ?? ''} ${(entry.keywords ?? []).join(' ')}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');

const has = (pattern: RegExp) => (entry: GlyphCatalogEntry) => pattern.test(normalized(entry));
const named = (names: readonly string[]) => {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return (entry: GlyphCatalogEntry) => wanted.has((entry.slug ?? entry.name).toLowerCase());
};

export const MATERIAL_ESSENTIALS = [
  'home', 'search', 'menu', 'settings', 'person', 'favorite', 'star', 'notifications',
  'mail', 'chat', 'call', 'calendar_month', 'schedule', 'location_on', 'map', 'folder',
  'description', 'photo', 'camera_alt', 'play_arrow', 'pause', 'download', 'upload', 'share',
  'edit', 'delete', 'add', 'remove', 'check', 'close', 'lock', 'key', 'shopping_cart',
  'cloud', 'sunny', 'dark_mode', 'wifi', 'refresh', 'more_horiz',
] as const;

const BRAND_POPULAR = [
  'apple', 'google', 'microsoft', 'amazon', 'youtube', 'instagram', 'tiktok', 'facebook',
  'x', 'github', 'discord', 'spotify', 'slack', 'notion', 'figma', 'canva', 'dropbox',
] as const;

const all = (_entry: GlyphCatalogEntry) => true;

export const GLYPH_SECTIONS: Record<GlyphCatalogId, GlyphSection[]> = {
  material: [
    { id: 'essentials', label: 'Essentials', description: 'A practical starter family of the most reusable app icons.', matches: named(MATERIAL_ESSENTIALS) },
    { id: 'files', label: 'Files & work', description: 'Documents, folders, calendars, editing, saving, and productivity.', matches: has(/(folder|file|document|description|article|note|edit|save|archive|calendar|schedule|task|work|print|attach|upload|download)/) },
    { id: 'communication', label: 'Communication', description: 'Mail, chat, calls, contacts, notifications, and sharing.', matches: has(/(mail|email|chat|message|call|phone|contact|person|group|forum|notification|share|send|inbox)/) },
    { id: 'media', label: 'Photos & media', description: 'Photography, video, audio, playback, and creative tools.', matches: has(/(photo|image|camera|video|movie|music|audio|mic|play|pause|volume|album|palette|brush)/) },
    { id: 'commerce', label: 'Shopping & money', description: 'Stores, carts, payments, banking, shipping, and receipts.', matches: has(/(shop|store|cart|bag|payment|credit|wallet|money|currency|bank|receipt|sell|inventory|package|shipping|delivery)/) },
    { id: 'travel', label: 'Places & travel', description: 'Maps, locations, transport, lodging, and destinations.', matches: has(/(map|location|place|pin|navigation|flight|train|bus|car|taxi|bike|walk|travel|hotel|luggage|route|explore)/) },
    { id: 'nature', label: 'Weather & nature', description: 'Weather, plants, animals, landscapes, and the outdoors.', matches: has(/(weather|sun|sunny|cloud|rain|snow|storm|wind|water|nature|forest|park|tree|flower|eco|leaf|pet|animal)/) },
    { id: 'wellness', label: 'People & wellness', description: 'People, accessibility, health, fitness, food, and self-care.', matches: has(/(person|people|face|accessib|health|medical|hospital|fitness|exercise|sport|food|restaurant|spa|heart|mood|child|family)/) },
    { id: 'devices', label: 'Devices & home', description: 'Phones, computers, connectivity, smart homes, and utilities.', matches: has(/(phone|smartphone|tablet|computer|laptop|desktop|tv|watch|wifi|bluetooth|battery|router|device|home|light|thermostat|power)/) },
    { id: 'actions', label: 'Actions & status', description: 'Navigation, selection, alerts, progress, and interface controls.', matches: has(/(arrow|chevron|menu|more|add|remove|close|check|done|refresh|sync|search|filter|sort|warning|error|info|help|lock|visibility)/) },
    { id: 'all', label: 'All symbols', description: 'The complete Material Symbols inventory.', matches: all },
  ],
  y2k: [
    { id: 'all', label: 'All concepts', description: 'Purpose-built concepts that generate well as a cohesive styled family.', matches: all },
    { id: 'celestial', label: 'Celestial', description: 'Stars, planets, moons, clouds, and dreamy weather.', matches: has(/y2k_celestial/) },
    { id: 'nature', label: 'Nature', description: 'Flowers, butterflies, plants, and organic motifs.', matches: has(/y2k_nature/) },
    { id: 'lifestyle', label: 'Lifestyle', description: 'Fashion, beauty, food, music, and everyday objects.', matches: has(/y2k_lifestyle/) },
    { id: 'tech', label: 'Retro tech', description: 'Computers, discs, cameras, phones, and nostalgic gadgets.', matches: has(/y2k_retro_tech/) },
    { id: 'romance', label: 'Romance', description: 'Hearts, bows, love notes, and playful romantic symbols.', matches: has(/y2k_romance/) },
  ],
  brands: [
    { id: 'popular', label: 'Popular', description: 'Frequently used platforms and services.', matches: named(BRAND_POPULAR) },
    { id: 'social', label: 'Social & community', description: 'Social networks, messaging, video, and communities.', matches: has(/(facebook|instagram|threads|tiktok|youtube|reddit|discord|linkedin|whatsapp|telegram|snapchat|mastodon|pinterest)/) },
    { id: 'creative', label: 'Creative tools', description: 'Design, photography, video, and creative software brands.', matches: has(/(adobe|figma|canva|blender|dribbble|behance|unsplash|vimeo|pinterest|sketch|affinity)/) },
    { id: 'commerce', label: 'Commerce', description: 'Shopping, payments, marketplaces, and business services.', matches: has(/(shopify|etsy|ebay|amazon|paypal|stripe|square|klarna|visa|mastercard|woocommerce)/) },
    { id: 'developer', label: 'Developer tools', description: 'Code hosting, languages, frameworks, cloud, and infrastructure.', matches: has(/(github|gitlab|npm|node|react|vue|python|docker|kubernetes|aws|azure|cloudflare|vercel|code|linux|ubuntu)/) },
    { id: 'all', label: 'All brands', description: 'The complete Simple Icons brand-logo inventory.', matches: all },
  ],
};

export function humanizeGlyphName(name: string, catalogId: GlyphCatalogId): string {
  if (catalogId !== 'material') return name;
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function glyphEntryKey(entry: GlyphCatalogEntry): string {
  return entry.slug ?? entry.name;
}

export function organizeGlyphEntries(
  entries: GlyphCatalogEntry[],
  catalogId: GlyphCatalogId,
  sectionId: string,
  query: string,
): GlyphCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  const section = GLYPH_SECTIONS[catalogId].find((candidate) => candidate.id === sectionId)
    ?? GLYPH_SECTIONS[catalogId][0];
  const matches = entries.filter((entry) => {
    if (!needle) return section.matches(entry);
    return `${humanizeGlyphName(entry.name, catalogId)} ${entry.name} ${entry.category ?? ''} ${(entry.keywords ?? []).join(' ')}`
      .toLowerCase()
      .includes(needle);
  });

  const preferred = catalogId === 'material' && section.id === 'essentials'
    ? MATERIAL_ESSENTIALS
    : catalogId === 'brands' && section.id === 'popular'
      ? BRAND_POPULAR
      : null;
  const rank = preferred
    ? new Map<string, number>(preferred.map((name, index) => [name, index]))
    : null;

  return [...matches].sort((a, b) => {
    if (rank) {
      const aRank = rank.get(glyphEntryKey(a).toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      const bRank = rank.get(glyphEntryKey(b).toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
    }
    return humanizeGlyphName(a.name, catalogId).localeCompare(humanizeGlyphName(b.name, catalogId));
  });
}
