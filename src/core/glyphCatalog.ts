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

/**
 * A phone icon-pack starter set, not a generic UI-control inventory.
 *
 * The categories favor apps and functions people recognize on a home screen.
 * Low-level controls (pagination, layout modes, toggle states, and repeated
 * arrows) remain discoverable in the complete Material Symbols catalog.
 */
export const MOBILE_ICON_GROUPS = {
  core: [
    'home', 'search', 'apps', 'settings', 'notifications', 'phone_in_talk', 'sms',
    'contacts', 'mail', 'photo_camera', 'photo_library', 'calendar_month', 'alarm',
    'calculate', 'folder', 'map', 'sunny', 'music_note', 'play_circle', 'shopping_bag',
    'account_balance_wallet', 'health_and_safety', 'language', 'public', 'translate',
    'qr_code_scanner', 'flashlight_on', 'download', 'cloud', 'wifi', 'bluetooth',
    'battery_full', 'lock', 'shield', 'help',
  ],
  communication: [
    'chat', 'forum', 'send', 'inbox', 'alternate_email', 'video_call', 'voice_chat',
    'voicemail', 'contact_page', 'group', 'groups', 'person', 'person_add', 'share',
    'link', 'campaign', 'notifications_active', 'quickreply', 'wifi_calling', 'call',
    'call_end', 'call_missed', 'mark_email_read', 'mark_email_unread', 'speaker_phone',
    'ring_volume', 'emoji_people', 'diversity_3', 'handshake', 'volunteer_activism',
    'thumbs_up_down', 'favorite', 'mood', 'support_agent', 'record_voice_over',
  ],
  media: [
    'photo', 'image', 'videocam', 'movie', 'mic', 'headphones', 'album', 'queue_music',
    'radio', 'podcasts', 'library_music', 'video_library', 'palette', 'brush', 'draw',
    'camera', 'camera_roll', 'music_video', 'subscriptions', 'live_tv', 'cast',
    'equalizer', 'graphic_eq', 'animation', 'auto_awesome_mosaic', 'theaters',
    'toys_and_games', 'sports_esports', 'menu_book', 'newspaper',
  ],
  productivity: [
    'folder_open', 'create_new_folder', 'description', 'article', 'note_alt', 'notes',
    'task', 'checklist', 'event', 'schedule', 'print', 'archive', 'work', 'file_copy',
    'file_export', 'file_save', 'drive_file_move', 'topic', 'snippet_folder',
    'folder_shared', 'event_available', 'edit_document', 'document_scanner',
    'attach_file', 'upload', 'cloud_upload', 'cloud_download', 'backup', 'history',
    'timer', 'password', 'key', 'table_chart', 'analytics', 'school',
  ],
  commerce: [
    'shopping_cart', 'store', 'payments', 'credit_card', 'account_balance',
    'receipt_long', 'sell', 'price_check', 'inventory_2', 'add_shopping_cart',
    'shopping_basket', 'redeem', 'percent_discount', 'currency_exchange',
    'request_quote', 'savings', 'paid', 'point_of_sale', 'barcode_scanner', 'loyalty',
    'featured_seasonal_and_gifts', 'local_mall', 'storefront', 'grocery',
    'shoppingmode', 'restaurant', 'fastfood', 'local_cafe', 'bakery_dining',
    'delivery_truck_speed',
  ],
  travel: [
    'location_on', 'navigation', 'near_me', 'explore', 'directions_car',
    'directions_bus', 'train', 'flight', 'hotel', 'local_taxi', 'directions_bike',
    'directions_walk', 'two_wheeler', 'local_shipping', 'local_parking',
    'local_gas_station', 'beach_access', 'luggage', 'route', 'travel_explore',
    'commute', 'airport_shuttle', 'subway', 'directions_boat', 'ev_station',
    'car_rental', 'connecting_airports', 'passport', 'confirmation_number',
    'local_activity',
  ],
  wellness: [
    'fitness_center', 'medical_services', 'water_drop', 'dark_mode', 'light_mode',
    'bedtime', 'monitor_heart', 'medication', 'local_hospital', 'emergency', 'vaccines',
    'psychology', 'self_improvement', 'spa', 'nutrition', 'exercise', 'sports', 'pool',
    'hiking', 'pets', 'child_care', 'family_restroom', 'cake', 'celebration', 'chef_hat',
    'eco', 'forest', 'park', 'garden_cart', 'local_florist',
  ],
  devices: [
    'mobile_2', 'tablet', 'laptop_windows', 'desktop_windows', 'watch', 'computer',
    'keyboard', 'mouse', 'router', 'battery_charging_full', 'signal_cellular_alt',
    'mobile_3', 'devices', 'connected_tv', 'thermostat', 'lightbulb', 'power',
    'cleaning_services', 'local_laundry_service', 'garage', 'door_front', 'security',
    'camera_outdoor', 'doorbell', 'smart_toy',
  ],
} as const;

export const MATERIAL_ESSENTIALS = [
  ...MOBILE_ICON_GROUPS.core,
  ...MOBILE_ICON_GROUPS.communication,
  ...MOBILE_ICON_GROUPS.media,
  ...MOBILE_ICON_GROUPS.productivity,
  ...MOBILE_ICON_GROUPS.commerce,
  ...MOBILE_ICON_GROUPS.travel,
  ...MOBILE_ICON_GROUPS.wellness,
  ...MOBILE_ICON_GROUPS.devices,
] as const;

/**
 * Evidence-weighted mobile icon-pack demand order. Current app usage is the
 * primary signal; repeated icon-pack must-have/request mentions break ties.
 * Entries that Simple Icons cannot legally distribute are intentionally absent.
 */
export const BRAND_PRIORITY = [
  'youtube', 'facebook', 'instagram', 'whatsapp', 'tiktok', 'googlechrome', 'gmail',
  'googlemaps', 'netflix', 'spotify', 'telegram', 'messenger', 'snapchat', 'reddit',
  'discord', 'pinterest', 'threads', 'x', 'twitch', 'signal', 'roblox', 'youtubemusic',
  'ebay', 'etsy', 'paypal', 'cashapp', 'venmo', 'target', 'doordash', 'ubereats',
  'instacart', 'aliexpress', 'uber', 'lyft', 'airbnb', 'bookingdotcom', 'tripadvisor',
  'waze', 'dropbox', 'notion', 'figma', 'zoom', 'googledrive', 'googlecalendar',
  'googlemeet', 'firefox', 'safari', 'github', 'trello', 'asana', 'todoist', 'hbomax',
  'plex', 'crunchyroll', 'steam', 'playstation', 'soundcloud', 'patreon', 'bluesky',
  'wechat', 'line', 'viber', 'mastodon', 'tumblr', 'nextdoor', 'quora', 'medium',
  'substack', 'bereal', 'meetup', 'flickr', 'clubhouse', 'box', 'webex', 'shopify',
] as const;

export const BRAND_SOCIAL_PRIORITY = [
  'youtube', 'facebook', 'instagram', 'whatsapp', 'tiktok', 'messenger', 'telegram',
  'snapchat', 'reddit', 'pinterest', 'threads', 'x', 'discord', 'twitch', 'signal',
  'wechat', 'line', 'bluesky', 'tumblr', 'mastodon', 'nextdoor', 'quora', 'medium',
  'substack', 'bereal', 'viber', 'patreon', 'meetup', 'flickr', 'clubhouse', 'matrix',
  'simplex',
] as const;

export const BRAND_ENTERTAINMENT_PRIORITY = [
  'youtube', 'netflix', 'spotify', 'tiktok', 'youtubemusic', 'twitch', 'roblox',
  'hbomax', 'plex', 'crunchyroll', 'steam', 'playstation', 'soundcloud', 'audible',
  'pandora', 'deezer', 'tidal', 'iheartradio', 'pocketcasts', 'castbox', 'vimeo',
  'youtubetv', 'youtubekids', 'youtubegaming', 'facebookgaming', 'facebooklive',
  'epicgames',
] as const;

export const BRAND_COMMERCE_PRIORITY = [
  'paypal', 'cashapp', 'venmo', 'ebay', 'etsy', 'target', 'doordash', 'ubereats',
  'instacart', 'aliexpress', 'shopify', 'klarna', 'afterpay', 'square', 'stripe',
  'wise', 'revolut', 'coinbase', 'binance', 'robinhood', 'stockx', 'mercadopago',
  'okx', 'wazirx', 'deliveroo', 'justeat', 'fedex', 'ups', 'dhl',
] as const;

export const BRAND_TRAVEL_PRIORITY = [
  'googlemaps', 'uber', 'lyft', 'airbnb', 'bookingdotcom', 'tripadvisor', 'waze',
  'doordash', 'ubereats', 'instacart', 'deliveroo', 'justeat', 'expedia', 'fedex',
  'ups', 'dhl', 'southwestairlines', 'unitedairlines', 'americanairlines', 'delta',
  'singaporeairlines', 'turkishairlines', 'japanairlines', 'ethiopianairlines',
  'copaairlines',
] as const;

export const BRAND_WORK_PRIORITY = [
  'gmail', 'googlechrome', 'googledrive', 'googlecalendar', 'googlemeet', 'googledocs',
  'googlesheets', 'dropbox', 'notion', 'figma', 'zoom', 'firefox', 'safari', 'github',
  'trello', 'asana', 'todoist', 'box', 'webex', 'linear', 'jira', 'evernote',
  'wordpress', 'squarespace', 'wix', 'dribbble', 'behance', 'sketch', 'blender',
  'unsplash', 'vimeo', 'protonmail', 'icloud', 'canvas',
] as const;

const BRAND_SECTION_PRIORITY: Record<string, readonly string[]> = {
  popular: BRAND_PRIORITY,
  social: BRAND_SOCIAL_PRIORITY,
  entertainment: BRAND_ENTERTAINMENT_PRIORITY,
  commerce: BRAND_COMMERCE_PRIORITY,
  travel: BRAND_TRAVEL_PRIORITY,
  creative: BRAND_WORK_PRIORITY,
  all: BRAND_PRIORITY,
};

const all = (_entry: GlyphCatalogEntry) => true;

export const GLYPH_SECTIONS: Record<GlyphCatalogId, GlyphSection[]> = {
  mobile: [
    { id: 'all', label: 'All 250', description: 'The complete researched phone icon-pack collection.', matches: named(MATERIAL_ESSENTIALS) },
    { id: 'core', label: 'Phone basics (35)', description: 'The apps and utilities most people expect on every phone.', matches: named(MOBILE_ICON_GROUPS.core) },
    { id: 'communication', label: 'Communication & social (35)', description: 'Calls, messaging, mail, contacts, communities, and sharing.', matches: named(MOBILE_ICON_GROUPS.communication) },
    { id: 'media', label: 'Photos, media & creative (30)', description: 'Camera, gallery, music, video, reading, games, and creative apps.', matches: named(MOBILE_ICON_GROUPS.media) },
    { id: 'productivity', label: 'Work & organization (35)', description: 'Files, notes, calendars, tasks, cloud storage, school, and work.', matches: named(MOBILE_ICON_GROUPS.productivity) },
    { id: 'commerce', label: 'Money, shopping & food (30)', description: 'Banking, payments, stores, grocery, dining, rewards, and delivery.', matches: named(MOBILE_ICON_GROUPS.commerce) },
    { id: 'travel', label: 'Maps, travel & transport (30)', description: 'Navigation, commuting, vehicles, tickets, lodging, and destinations.', matches: named(MOBILE_ICON_GROUPS.travel) },
    { id: 'wellness', label: 'Health & lifestyle (30)', description: 'Health, fitness, family, food, pets, nature, and self-care.', matches: named(MOBILE_ICON_GROUPS.wellness) },
    { id: 'devices', label: 'Devices, home & security (25)', description: 'Computers, wearables, connectivity, smart home, cleaning, and safety.', matches: named(MOBILE_ICON_GROUPS.devices) },
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
    { id: 'popular', label: 'Most requested (75)', description: 'Mobile brands ranked by current usage and recurring icon-pack demand.', matches: named(BRAND_PRIORITY) },
    { id: 'social', label: 'Social & messaging (32)', description: 'Social, messaging, video, and community apps in demand order.', matches: named(BRAND_SOCIAL_PRIORITY) },
    { id: 'entertainment', label: 'Entertainment (27)', description: 'Streaming, music, gaming, podcasts, and creator platforms.', matches: named(BRAND_ENTERTAINMENT_PRIORITY) },
    { id: 'commerce', label: 'Shopping & money (29)', description: 'Payments, shopping, delivery, banking, and investing brands.', matches: named(BRAND_COMMERCE_PRIORITY) },
    { id: 'travel', label: 'Travel & delivery (25)', description: 'Maps, rides, lodging, travel, airlines, couriers, and delivery.', matches: named(BRAND_TRAVEL_PRIORITY) },
    { id: 'creative', label: 'Work & creative (34)', description: 'Mail, browsers, cloud, productivity, design, and publishing tools.', matches: named(BRAND_WORK_PRIORITY) },
    { id: 'developer', label: 'Developer tools', description: 'Code hosting, languages, frameworks, cloud, and infrastructure.', matches: has(/(github|gitlab|npm|node|react|vue|python|docker|kubernetes|aws|azure|cloudflare|vercel|code|linux|ubuntu)/) },
    { id: 'all', label: 'All brands', description: 'Most-requested mobile brands first, followed by the complete alphabetical inventory.', matches: all },
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
    : catalogId === 'brands'
      ? BRAND_SECTION_PRIORITY[section.id] ?? null
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
