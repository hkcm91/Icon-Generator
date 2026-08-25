export type GlyphCatalogId = 'mobile' | 'material' | 'y2k' | 'brands';

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
  // Navigation and layout (30)
  'home', 'menu', 'search', 'apps', 'arrow_back', 'arrow_forward', 'arrow_upward',
  'arrow_downward', 'chevron_left', 'chevron_right', 'keyboard_arrow_up',
  'keyboard_arrow_down', 'close', 'more_vert', 'more_horiz', 'fullscreen',
  'fullscreen_exit', 'refresh', 'sync', 'open_in_new', 'first_page', 'last_page',
  'unfold_more', 'drag_handle', 'dashboard', 'view_list', 'grid_view', 'tab', 'swipe',
  'shield',

  // Actions and status (35)
  'add', 'remove', 'check', 'done_all', 'edit', 'delete', 'save', 'share', 'download',
  'upload', 'content_copy', 'undo', 'redo', 'filter_list', 'sort', 'tune', 'settings',
  'favorite', 'heart_plus', 'star', 'star_half', 'bookmark', 'bookmark_add', 'info',
  'help', 'warning', 'error', 'check_circle', 'cancel', 'add_circle', 'do_not_disturb_on',
  'visibility', 'visibility_off', 'lock', 'lock_open',

  // Communication (20)
  'mail', 'inbox', 'send', 'reply', 'forward', 'chat', 'forum', 'sms', 'call',
  'phone_in_talk', 'contacts', 'contact_page', 'notifications', 'notifications_off',
  'alternate_email', 'language', 'public', 'link', 'attach_file', 'campaign',

  // Files and productivity (20)
  'folder', 'folder_open', 'create_new_folder', 'description', 'article', 'note_alt',
  'notes', 'task', 'checklist', 'event', 'calendar_month', 'schedule', 'alarm', 'print',
  'archive', 'unarchive', 'cloud', 'cloud_upload', 'cloud_download', 'work',

  // Photos, video, and audio (20)
  'photo', 'image', 'photo_library', 'photo_camera', 'videocam', 'movie', 'music_note',
  'mic', 'play_arrow', 'pause', 'stop', 'skip_next', 'skip_previous', 'fast_forward',
  'fast_rewind', 'volume_up', 'volume_off', 'cast', 'palette', 'brush',

  // People and social (12)
  'person', 'person_add', 'group', 'groups', 'account_circle', 'face', 'mood',
  'sentiment_satisfied', 'thumb_up', 'thumb_down', 'handshake', 'diversity_3',

  // Shopping and money (12)
  'shopping_cart', 'shopping_bag', 'store', 'payments', 'credit_card', 'account_balance',
  'account_balance_wallet', 'receipt_long', 'sell', 'price_check', 'inventory_2',
  'qr_code_scanner',

  // Maps and travel (12)
  'location_on', 'map', 'navigation', 'near_me', 'explore', 'directions_car',
  'directions_bus', 'train', 'flight', 'hotel', 'restaurant', 'local_taxi',

  // Devices, environment, and health (14)
  'mobile_2', 'tablet', 'laptop_windows', 'desktop_windows', 'watch', 'headphones',
  'wifi', 'bluetooth', 'battery_full', 'sunny', 'dark_mode', 'water_drop',
  'fitness_center', 'medical_services',
] as const;

const BRAND_POPULAR = [
  'apple', 'google', 'microsoft', 'amazon', 'youtube', 'instagram', 'tiktok', 'facebook',
  'x', 'github', 'discord', 'spotify', 'slack', 'notion', 'figma', 'canva', 'dropbox',
] as const;

const all = (_entry: GlyphCatalogEntry) => true;

export const GLYPH_SECTIONS: Record<GlyphCatalogId, GlyphSection[]> = {
  mobile: [
    { id: 'all', label: 'All 175', description: 'The complete mobile essentials collection.', matches: named(MATERIAL_ESSENTIALS) },
    { id: 'navigation', label: 'Navigation (30)', description: 'Navigation, layout, menus, views, and common mobile gestures.', matches: named(MATERIAL_ESSENTIALS.slice(0, 30)) },
    { id: 'actions', label: 'Actions & status (35)', description: 'Editing, selection, settings, feedback, security, and app states.', matches: named(MATERIAL_ESSENTIALS.slice(30, 65)) },
    { id: 'communication', label: 'Communication (20)', description: 'Mail, messaging, calls, contacts, notifications, and sharing.', matches: named(MATERIAL_ESSENTIALS.slice(65, 85)) },
    { id: 'files', label: 'Files & work (20)', description: 'Files, notes, calendars, tasks, cloud storage, and productivity.', matches: named(MATERIAL_ESSENTIALS.slice(85, 105)) },
    { id: 'media', label: 'Media (20)', description: 'Photography, video, audio, playback, and creative tools.', matches: named(MATERIAL_ESSENTIALS.slice(105, 125)) },
    { id: 'people', label: 'People (12)', description: 'Profiles, groups, reactions, community, and social activity.', matches: named(MATERIAL_ESSENTIALS.slice(125, 137)) },
    { id: 'commerce', label: 'Shopping (12)', description: 'Shopping, stores, payments, banking, offers, and inventory.', matches: named(MATERIAL_ESSENTIALS.slice(137, 149)) },
    { id: 'travel', label: 'Travel (12)', description: 'Maps, locations, navigation, transportation, lodging, and food.', matches: named(MATERIAL_ESSENTIALS.slice(149, 161)) },
    { id: 'devices', label: 'Devices & wellness (14)', description: 'Mobile devices, connectivity, environment, fitness, and health.', matches: named(MATERIAL_ESSENTIALS.slice(161, 175)) },
  ],
  material: [
    { id: 'all', label: 'All symbols', description: 'The complete Material Symbols inventory.', matches: all },
    { id: 'files', label: 'Files & work', description: 'Documents, folders, calendars, editing, saving, and productivity.', matches: has(/(folder|file|document|description|article|note|edit|save|archive|calendar|schedule|task|work|print|attach|upload|download)/) },
    { id: 'communication', label: 'Communication', description: 'Mail, chat, calls, contacts, notifications, and sharing.', matches: has(/(mail|email|chat|message|call|phone|contact|person|group|forum|notification|share|send|inbox)/) },
    { id: 'media', label: 'Photos & media', description: 'Photography, video, audio, playback, and creative tools.', matches: has(/(photo|image|camera|video|movie|music|audio|mic|play|pause|volume|album|palette|brush)/) },
    { id: 'commerce', label: 'Shopping & money', description: 'Stores, carts, payments, banking, shipping, and receipts.', matches: has(/(shop|store|cart|bag|payment|credit|wallet|money|currency|bank|receipt|sell|inventory|package|shipping|delivery)/) },
    { id: 'travel', label: 'Places & travel', description: 'Maps, locations, transport, lodging, and destinations.', matches: has(/(map|location|place|pin|navigation|flight|train|bus|car|taxi|bike|walk|travel|hotel|luggage|route|explore)/) },
    { id: 'nature', label: 'Weather & nature', description: 'Weather, plants, animals, landscapes, and the outdoors.', matches: has(/(weather|sun|sunny|cloud|rain|snow|storm|wind|water|nature|forest|park|tree|flower|eco|leaf|pet|animal)/) },
    { id: 'wellness', label: 'People & wellness', description: 'People, accessibility, health, fitness, food, and self-care.', matches: has(/(person|people|face|accessib|health|medical|hospital|fitness|exercise|sport|food|restaurant|spa|heart|mood|child|family)/) },
    { id: 'devices', label: 'Devices & home', description: 'Phones, computers, connectivity, smart homes, and utilities.', matches: has(/(phone|smartphone|tablet|computer|laptop|desktop|tv|watch|wifi|bluetooth|battery|router|device|home|light|thermostat|power)/) },
    { id: 'actions', label: 'Actions & status', description: 'Navigation, selection, alerts, progress, and interface controls.', matches: has(/(arrow|chevron|menu|more|add|remove|close|check|done|refresh|sync|search|filter|sort|warning|error|info|help|lock|visibility)/) },
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
  if (catalogId !== 'material' && catalogId !== 'mobile') return name;
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
  const mobileNames = new Set<string>(MATERIAL_ESSENTIALS);
  const scopedEntries = catalogId === 'mobile'
    ? entries.filter((entry) => mobileNames.has(glyphEntryKey(entry).toLowerCase()))
    : entries;
  const matches = scopedEntries.filter((entry) => {
    if (!needle) return section.matches(entry);
    return `${humanizeGlyphName(entry.name, catalogId)} ${entry.name} ${entry.category ?? ''} ${(entry.keywords ?? []).join(' ')}`
      .toLowerCase()
      .includes(needle);
  });

  const preferred = catalogId === 'mobile'
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
