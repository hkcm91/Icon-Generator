import { describe, expect, it } from 'vitest';
import {
  adaptiveIconXml,
  ANDROID_DENSITIES,
  appIconContentsJson,
  IOS_ROLES,
  PLATFORM_TARGETS,
} from '../src/core/export';
import { ADAPTIVE_DP, ADAPTIVE_SAFE_DP } from '../src/core/compose';

describe('iOS app icon set', () => {
  it('carries the marketing icon at exactly 1024', () => {
    const marketing = IOS_ROLES.filter((role) => role.idiom === 'ios-marketing');
    expect(marketing).toHaveLength(1);
    expect(marketing[0].size).toBe(1024);
  });

  it('sizes every role as its points times its scale', () => {
    for (const role of IOS_ROLES) {
      const points = Number.parseFloat(role.points.split('x')[0]);
      const scale = Number.parseInt(role.scale, 10);
      expect(role.size).toBe(Math.round(points * scale));
    }
  });

  it('gives every role a distinct filename', () => {
    // Two roles legitimately share a pixel size (iPhone 40@3x and 60@2x are
    // both 120), so they must not also share a file.
    const names = IOS_ROLES.map((role) => role.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('writes a Contents.json Xcode can read', () => {
    const parsed = JSON.parse(appIconContentsJson());
    expect(parsed.info.version).toBe(1);
    expect(parsed.images).toHaveLength(IOS_ROLES.length);
    for (const image of parsed.images) {
      expect(image.filename).toMatch(/\.png$/);
      expect(image.idiom).toBeTruthy();
      expect(image.scale).toMatch(/^[123]x$/);
      expect(image.size).toMatch(/^[\d.]+x[\d.]+$/);
    }
  });

  it('is not left in the generic size list, which cannot express its rules', () => {
    // The generic loop writes RGBA and honours padding; iOS needs neither.
    expect(PLATFORM_TARGETS.some((target) => target.platform === 'ios')).toBe(false);
    expect(PLATFORM_TARGETS.some((target) => target.platform === 'android')).toBe(false);
  });
});

describe('Android adaptive icon', () => {
  it('declares all three layers, monochrome included', () => {
    const xml = adaptiveIconXml();
    expect(xml).toContain('<adaptive-icon');
    expect(xml).toContain('xmlns:android="http://schemas.android.com/apk/res/android"');
    for (const layer of ['background', 'foreground', 'monochrome']) {
      expect(xml).toContain(`<${layer} android:drawable="@mipmap/ic_launcher_${layer}" />`);
    }
  });

  it('keeps the safe zone inside the layer, or the mask would clip the artwork', () => {
    expect(ADAPTIVE_DP).toBe(108);
    expect(ADAPTIVE_SAFE_DP).toBeLessThanOrEqual(72); // what the launcher shows
    expect(ADAPTIVE_SAFE_DP).toBeLessThan(ADAPTIVE_DP);
  });

  it('lands every density on a whole pixel at both layer sizes', () => {
    // A fractional size would be rounded by the canvas anyway; better that the
    // density table never asks for one.
    for (const density of ANDROID_DENSITIES) {
      expect((ADAPTIVE_DP * density.scale) % 1).toBe(0);
      expect((48 * density.scale) % 1).toBe(0);
    }
  });

  it('covers mdpi through xxxhdpi with ascending, unique scales', () => {
    const names = ANDROID_DENSITIES.map((density) => density.name);
    expect(names).toEqual(['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']);
    const scales = ANDROID_DENSITIES.map((density) => density.scale);
    expect(scales).toEqual([...scales].sort((a, b) => a - b));
    expect(new Set(scales).size).toBe(scales.length);
  });
});
