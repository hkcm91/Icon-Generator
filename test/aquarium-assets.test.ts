import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script, no type declarations
import { classify, validateManifest } from '../scripts/aquarium-assets.mjs';
import manifest from '../aquarium/assets.manifest.json';

describe('aquarium asset licence policy', () => {
  it('clears public domain and work we own, whatever the delivery format', () => {
    for (const distribution of ['extractable', 'packed']) {
      expect(classify('CC0-1.0', distribution).verdict).toBe('clear');
      expect(classify('public-domain', distribution).verdict).toBe('clear');
      expect(classify('owned', distribution).verdict).toBe('clear');
    }
  });

  it('lets marketplace royalty-free terms through only once the meshes are packed', () => {
    // A loose .glb in an APK is one rename away from being a standalone file,
    // which is exactly what these licences forbid.
    expect(classify('turbosquid-royalty-free', 'extractable').verdict).toBe('blocked');
    expect(classify('fab-standard', 'extractable').verdict).toBe('blocked');
    expect(classify('unity-asset-store', 'extractable').verdict).toBe('blocked');
    expect(classify('cgtrader-royalty-free', 'packed').verdict).toBe('attribution');
  });

  it('refuses the Creative Commons variants a paid closed wallpaper cannot satisfy', () => {
    for (const license of ['CC-BY-SA-4.0', 'CC-BY-ND-4.0', 'CC-BY-NC-4.0', 'editorial']) {
      expect(classify(license, 'packed').verdict).toBe('blocked');
    }
  });

  it('asks for credit rather than blocking plain attribution licences', () => {
    expect(classify('CC-BY-4.0').verdict).toBe('attribution');
  });

  it('flags an unrecognised or absent licence instead of assuming it is safe', () => {
    expect(classify('some-vendor-eula').verdict).toBe('review');
    expect(classify(undefined).verdict).toBe('blocked');
    expect(classify('').verdict).toBe('blocked');
  });
});

describe('the shipped manifest', () => {
  it('is structurally complete', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('carries no asset that its own declared delivery format forbids', () => {
    const refused = manifest.assets
      .map((asset: { id: string; license: string }) => ({
        id: asset.id,
        ...classify(asset.license, manifest.distribution),
      }))
      .filter((row: { verdict: string }) => row.verdict === 'blocked' || row.verdict === 'review');
    expect(refused).toEqual([]);
  });

  it('names a source page for every third-party asset', () => {
    for (const asset of manifest.assets) {
      if (asset.license !== 'owned') expect(asset.page).toMatch(/^https:\/\//);
    }
  });
});
