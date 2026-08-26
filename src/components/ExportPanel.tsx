import { useState } from 'react';
import type { ComposeLayers, ComposeOptions } from '../core/compose';
import { renderMask } from '../core/compose';
import {
  blobBytes,
  buildAndroidResources,
  buildIco,
  buildIosAppIconSet,
  buildZip,
  canvasToBlob,
  download,
  ICO_SIZES,
  PLATFORM_TARGETS,
  renderAtSize,
  svgMask,
} from '../core/export';
import type { ContainerSpec } from '../core/spec';

interface Props {
  spec: ContainerSpec;
  compose: ComposeOptions;
  layers: ComposeLayers;
}

// ios and android are not in PLATFORM_TARGETS: each needs a resource tree
// rather than a flat list of sizes, so each has its own builder.
const PLATFORMS = ['ios', 'android', ...new Set(PLATFORM_TARGETS.map((t) => t.platform))];

export default function ExportPanel({ spec, compose, layers }: Props) {
  const [selected, setSelected] = useState<string[]>(PLATFORMS);
  const [busy, setBusy] = useState('');

  const toggle = (platform: string) =>
    setSelected((current) =>
      current.includes(platform)
        ? current.filter((entry) => entry !== platform)
        : [...current, platform],
    );

  const exportZip = async () => {
    setBusy('Rendering every size natively…');
    try {
      const targets = PLATFORM_TARGETS.filter((target) => selected.includes(target.platform));
      const files: Array<{ name: string; bytes: Uint8Array<ArrayBuffer> }> = [];

      for (const target of targets) {
        // Rendered at native size, not downscaled from a master, so a 16px
        // corner is antialiased for 16px rather than resampled from 1024.
        const canvas = renderAtSize(spec, target.size, layers, compose);
        files.push({
          name: `${target.platform}/${target.name}.png`,
          bytes: await blobBytes(await canvasToBlob(canvas)),
        });
      }

      if (selected.includes('ios')) {
        files.push(...buildIosAppIconSet(spec, layers, compose));
      }

      if (selected.includes('android')) {
        files.push(...(await buildAndroidResources(spec, layers, compose)));
      }

      if (selected.includes('windows')) {
        const entries = [];
        for (const size of ICO_SIZES) {
          const canvas = renderAtSize(spec, size, layers, compose);
          entries.push({ size, bytes: await blobBytes(await canvasToBlob(canvas)) });
        }
        files.push({ name: 'windows/icon.ico', bytes: await blobBytes(await buildIco(entries)) });
      }

      files.push({
        name: 'container-mask.svg',
        bytes: new TextEncoder().encode(svgMask(spec)),
      });
      files.push({
        name: 'container-spec.json',
        bytes: new TextEncoder().encode(JSON.stringify(spec, null, 2)),
      });

      download(buildZip(files), 'icons.zip');
      setBusy('');
    } catch (error) {
      setBusy(`Export failed: ${(error as Error).message}`);
    }
  };

  const exportMaskPng = async () => {
    download(await canvasToBlob(renderMask(spec)), 'container-mask.png');
  };

  return (
    <section className="panel">
      <h2>Export</h2>
      <p className="hint">Every size is a fresh render from the spec, never a resample.</p>

      <div className="chips">
        {PLATFORMS.map((platform) => (
          <button
            key={platform}
            type="button"
            className={selected.includes(platform) ? 'chip chip-on' : 'chip'}
            onClick={() => toggle(platform)}
          >
            {platform}
          </button>
        ))}
      </div>

      <div className="row">
        <button type="button" onClick={exportZip} disabled={!selected.length || busy.endsWith('…')}>
          Export .zip
        </button>
        <button type="button" className="ghost" onClick={exportMaskPng}>
          Mask PNG
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => download(new Blob([svgMask(spec)], { type: 'image/svg+xml' }), 'container.svg')}
        >
          Container SVG
        </button>
      </div>

      {busy && <p className="status status-busy">{busy}</p>}
    </section>
  );
}
