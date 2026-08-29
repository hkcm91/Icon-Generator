/**
 * Licence gate for the aquarium wallpaper's third-party assets.
 *
 * Every mainstream marketplace licence permits selling the app and forbids
 * shipping the model where a third party can retrieve it alone. A live
 * wallpaper is an APK, an APK is a zip, and a loose .glb inside one is
 * retrieved by renaming the file — so the delivery format, not the purchase,
 * decides which licences are usable. That decision is `classify()` below;
 * docs/AQUARIUM-ASSETS.md is the reasoning behind it.
 *
 *   node scripts/aquarium-assets.mjs check    # policy + presence, exits non-zero on a violation
 *   node scripts/aquarium-assets.mjs lock     # hash acquired files into assets.lock.json
 *   node scripts/aquarium-assets.mjs attrib   # write THIRD-PARTY-LICENSES.md
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const AQUARIUM = new URL('../aquarium/', import.meta.url).pathname;
const MANIFEST = join(AQUARIUM, 'assets.manifest.json');
const LOCK = join(AQUARIUM, 'assets.lock.json');
const ATTRIB = join(AQUARIUM, 'THIRD-PARTY-LICENSES.md');

/** Licences whose terms are unaffected by whether the file can be extracted. */
const PUBLIC_DOMAIN = new Set(['CC0-1.0', 'CC0', 'PDM-1.0', 'public-domain', 'owned']);

/** Attribution required, but no restriction on extraction. */
const ATTRIBUTION = new Set(['CC-BY-3.0', 'CC-BY-4.0', 'CC-BY']);

/**
 * Marketplace royalty-free terms: commercial sale of the app is fine, the
 * asset must not be retrievable on its own. Legal only once we pack.
 */
const CONDITIONAL = new Set([
  'royalty-free',
  'turbosquid-royalty-free',
  'fab-standard',
  'unity-asset-store',
  'cgtrader-royalty-free',
  'sketchfab-standard',
]);

/** Terms no closed, paid wallpaper can satisfy. */
const REFUSED = {
  'CC-BY-SA-4.0': 'share-alike would extend to the wallpaper we are selling',
  'CC-BY-SA-3.0': 'share-alike would extend to the wallpaper we are selling',
  'CC-BY-SA': 'share-alike would extend to the wallpaper we are selling',
  'CC-BY-ND-4.0': 'no-derivatives, and decimating or converting to glTF is a derivative',
  'CC-BY-ND': 'no-derivatives, and decimating or converting to glTF is a derivative',
  'CC-BY-NC-4.0': 'non-commercial, and the wallpaper is sold',
  'CC-BY-NC-SA-4.0': 'non-commercial, and the wallpaper is sold',
  'CC-BY-NC-ND-4.0': 'non-commercial, and the wallpaper is sold',
  'CC-BY-NC': 'non-commercial, and the wallpaper is sold',
  editorial: 'editorial use only, which excludes a commercial product',
};

/**
 * Verdict for one licence under one delivery format.
 *
 * `distribution` is 'extractable' while we ship loose glTF in an APK, and
 * 'packed' once meshes go into a container a user cannot open by renaming it.
 */
export function classify(license, distribution = 'extractable') {
  if (!license) return { verdict: 'blocked', reason: 'no licence recorded' };
  if (PUBLIC_DOMAIN.has(license)) return { verdict: 'clear', reason: 'public domain or owned outright' };
  if (ATTRIBUTION.has(license)) return { verdict: 'attribution', reason: 'usable, but credit must ship with the app' };
  if (license in REFUSED) return { verdict: 'blocked', reason: REFUSED[license] };
  if (CONDITIONAL.has(license)) {
    return distribution === 'packed'
      ? { verdict: 'attribution', reason: 'royalty-free: legal once packed; keep the purchase receipt' }
      : {
          verdict: 'blocked',
          reason: 'royalty-free terms forbid a third party retrieving the file alone, and a loose asset in an APK is one rename away',
        };
  }
  return { verdict: 'review', reason: `unrecognised licence "${license}" — resolve it before it reaches a build` };
}

const REQUIRED = ['id', 'role', 'title', 'author', 'license', 'files'];

/** Structural problems in the manifest itself, independent of what is on disk. */
export function validateManifest(manifest) {
  const problems = [];
  const assets = manifest?.assets;
  if (!Array.isArray(assets)) return ['manifest has no assets array'];
  if (!['extractable', 'packed'].includes(manifest.distribution)) {
    problems.push(`distribution must be "extractable" or "packed", found ${JSON.stringify(manifest.distribution)}`);
  }
  const seen = new Set();
  for (const [i, asset] of assets.entries()) {
    const where = asset?.id ?? `assets[${i}]`;
    for (const field of REQUIRED) {
      if (asset?.[field] === undefined || asset[field] === null || asset[field] === '') {
        problems.push(`${where}: missing ${field}`);
      }
    }
    if (asset?.id) {
      if (seen.has(asset.id)) problems.push(`${where}: duplicate id`);
      seen.add(asset.id);
    }
    if (!Array.isArray(asset?.files) || asset.files.length === 0) {
      problems.push(`${where}: files must list at least one path`);
    }
    // Third-party work needs a page to attribute and re-acquire from; ours does not.
    if (asset?.license !== 'owned' && !asset?.page) {
      problems.push(`${where}: third-party asset needs a source page`);
    }
  }
  return problems;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Files on disk for one manifest entry; a trailing separator means a directory. */
function resolveFiles(root, patterns) {
  const found = [];
  for (const pattern of patterns) {
    const full = join(root, pattern);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found.sort();
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

function report(manifest) {
  const root = join(AQUARIUM, manifest.root ?? 'assets');
  const rows = manifest.assets.map((asset) => {
    const files = existsSync(root) ? resolveFiles(root, asset.files) : [];
    return { asset, files, ...classify(asset.license, manifest.distribution) };
  });
  return { root, rows };
}

const COMMANDS = {
  check() {
    const manifest = loadManifest();
    const problems = validateManifest(manifest);
    for (const problem of problems) console.error(`manifest: ${problem}`);

    const { root, rows } = report(manifest);
    console.log(`aquarium assets — shipping as "${manifest.distribution}", ${rows.length} slots\n`);

    const mark = { clear: 'ok      ', attribution: 'credit  ', blocked: 'BLOCKED ', review: 'REVIEW  ' };
    for (const row of rows) {
      const count = row.files.length ? `${row.files.length} file(s)` : 'not acquired';
      console.log(`${mark[row.verdict]}${row.asset.id.padEnd(24)} ${row.asset.license.padEnd(16)} ${count}`);
      if (row.verdict !== 'clear') console.log(`${' '.repeat(8)}${row.reason}`);
    }

    const bad = rows.filter((r) => r.verdict === 'blocked' || r.verdict === 'review');
    const credited = rows.filter((r) => r.verdict === 'attribution');
    const missing = rows.filter((r) => !r.files.length && r.asset.license !== 'owned');
    console.log('');
    if (credited.length) console.log(`${credited.length} asset(s) require a credits screen — run "attrib" and link it from settings.`);
    if (missing.length) {
      console.log(`${missing.length} asset(s) not yet acquired. Download from the page in the manifest into ${relative(process.cwd(), root)}:`);
      for (const row of missing) console.log(`  ${row.asset.id}  ${row.asset.page}`);
    }
    if (bad.length || problems.length) {
      console.error(`\n${bad.length} licence violation(s), ${problems.length} manifest problem(s).`);
      process.exitCode = 1;
    } else {
      console.log('No licence violations.');
    }
  },

  lock() {
    const manifest = loadManifest();
    const { root, rows } = report(manifest);
    const files = {};
    for (const row of rows) {
      for (const file of row.files) {
        files[relative(root, file).split(sep).join('/')] = { asset: row.asset.id, sha256: sha256(file), bytes: statSync(file).size };
      }
    }
    const previous = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')).files ?? {} : {};
    for (const [path, entry] of Object.entries(previous)) {
      if (files[path] && files[path].sha256 !== entry.sha256) console.log(`changed: ${path}`);
      if (!files[path]) console.log(`gone:    ${path}`);
    }
    writeFileSync(LOCK, `${JSON.stringify({ distribution: manifest.distribution, files }, null, 2)}\n`);
    console.log(`Locked ${Object.keys(files).length} file(s) into ${relative(process.cwd(), LOCK)}.`);
  },

  attrib() {
    const manifest = loadManifest();
    const { rows } = report(manifest);
    const third = rows.filter((r) => r.asset.license !== 'owned');
    const lines = [
      '# Third-party assets',
      '',
      'Generated by `node scripts/aquarium-assets.mjs attrib`. Ship this reachable',
      'from the wallpaper settings; CC-BY needs title, author, licence and link, and',
      'crediting the public-domain sources costs nothing.',
      '',
    ];
    for (const row of third) {
      lines.push(`## ${row.asset.title}`, '');
      lines.push(`- Author: ${row.asset.author}`);
      lines.push(`- Licence: ${row.asset.license}${row.verdict === 'attribution' ? ' (attribution required)' : ''}`);
      if (row.asset.page) lines.push(`- Source: ${row.asset.page}`);
      lines.push(`- Used for: ${row.asset.role}`, '');
    }
    writeFileSync(ATTRIB, `${lines.join('\n')}\n`);
    console.log(`Wrote ${third.length} credit(s) to ${relative(process.cwd(), ATTRIB)}.`);
  },
};

// Only run the CLI when invoked directly; the test suite imports the policy.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(sep).pop())) {
  const command = process.argv[2] ?? 'check';
  if (!COMMANDS[command]) {
    console.error(`Unknown command "${command}". Expected one of: ${Object.keys(COMMANDS).join(', ')}.`);
    process.exit(2);
  }
  COMMANDS[command]();
}
