import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GLYPHS,
  LAYERS,
  allKeys,
  blobToImage,
  canvasToBlobAsync,
  clearStore,
  deleteBlob,
  getBlob,
  putBlob,
  replaceArtwork,
} from '../core/store';

const MATERIAL_KEY = 'material';
const SINGLE_GLYPH_KEY = 'glyph';
const FRAME_PREFIX = 'frame:';
const CONTAINER_OVERLAY_KEY = 'container-overlay';
const EXTRACTED_SUBJECT_KEY = 'extracted-subject';

export interface ImageBundle {
  material: string | null;
  glyph: string | null;
  glyphs: Record<string, string>;
  containerOverlay?: string | null;
  extractedSubject?: string | null;
  revisions?: Record<string, string>;
  frames?: Record<string, string>;
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not encode saved artwork.'));
    reader.readAsDataURL(blob);
  });
}

// Image elements are immutable artwork snapshots. Reuse their original bytes;
// editable canvases are encoded asynchronously each time to avoid stale pixels.
async function imageDataUrl(image: CanvasImageSource | null): Promise<string | null> {
  if (!image) return null;
  if (image instanceof HTMLImageElement) {
    if (image.src.startsWith('data:')) return image.src;
    if (image.src.startsWith('blob:')) return blobDataUrl(await (await fetch(image.src)).blob());
  }
  const width = (image as HTMLImageElement).naturalWidth || (image as HTMLCanvasElement).width || 1024;
  const height = (image as HTMLImageElement).naturalHeight || (image as HTMLCanvasElement).height || 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not encode artwork.');
  ctx.drawImage(image, 0, 0, width, height);
  const blob = await canvasToBlobAsync(canvas);
  if (!blob) throw new Error('Could not encode artwork.');
  return blobDataUrl(blob);
}

async function mapArtwork<T, R>(values: T[], work: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, values.length) }, async () => {
    while (next < values.length) { const index = next++; results[index] = await work(values[index]); }
  }));
  return results;
}

function dataUrlImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A saved project image could not be decoded.'));
    image.src = source;
  });
}

/**
 * Rendered layers, kept in memory and mirrored to IndexedDB so a refresh does
 * not throw away work that cost API calls to produce.
 *
 * Object URLs created while decoding stored blobs are tracked and revoked on
 * replacement, since a family of several hundred icons regenerated a few times
 * would otherwise leak steadily for the life of the tab.
 */
export function useImageStore() {
  const [loaded, setLoaded] = useState(false);
  const [glyphs, setGlyphs] = useState<Map<string, CanvasImageSource>>(new Map());
  const [material, setMaterialState] = useState<CanvasImageSource | null>(null);
  const [glyph, setGlyphState] = useState<CanvasImageSource | null>(null);
  const [containerOverlay, setContainerOverlayState] = useState<CanvasImageSource | null>(null);
  const [extractedSubject, setExtractedSubjectState] = useState<CanvasImageSource | null>(null);
  const [frames, setFrames] = useState<Map<string, CanvasImageSource>>(new Map());
  const urls = useRef(new Map<string, string>());
  const pending = useRef(new Set<Promise<unknown>>());

  const trackUrl = useCallback((key: string, image: HTMLImageElement) => {
    const previous = urls.current.get(key);
    if (previous) URL.revokeObjectURL(previous);
    urls.current.set(key, image.src);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const restored = new Map<string, CanvasImageSource>();
      for (const key of await allKeys(GLYPHS)) {
        if (key.includes('@v')) continue;
        const blob = await getBlob(GLYPHS, key);
        if (!blob) continue;
        try {
          const image = await blobToImage(blob);
          trackUrl(`glyph:${key}`, image);
          restored.set(key, image);
        } catch {
          // A corrupt entry should cost one card, not the whole restore.
        }
      }

      const materialBlob = await getBlob(LAYERS, MATERIAL_KEY);
      const singleBlob = await getBlob(LAYERS, SINGLE_GLYPH_KEY);
      const containerOverlayBlob = await getBlob(LAYERS, CONTAINER_OVERLAY_KEY);
      const extractedSubjectBlob = await getBlob(LAYERS, EXTRACTED_SUBJECT_KEY);
      const restoredFrames = new Map<string, CanvasImageSource>();
      for (const key of await allKeys(LAYERS)) {
        if (!key.startsWith(FRAME_PREFIX)) continue;
        const blob = await getBlob(LAYERS, key);
        if (!blob) continue;
        try {
          const image = await blobToImage(blob);
          trackUrl(`layer:${key}`, image);
          restoredFrames.set(key.slice(FRAME_PREFIX.length), image);
        } catch { /* one corrupt frame variant must not block the project */ }
      }
      if (!live) return;

      setGlyphs(restored);
      if (materialBlob) {
        const image = await blobToImage(materialBlob);
        trackUrl(`layer:${MATERIAL_KEY}`, image);
        if (live) setMaterialState(image);
      }
      if (singleBlob) {
        const image = await blobToImage(singleBlob);
        trackUrl(`layer:${SINGLE_GLYPH_KEY}`, image);
        if (live) setGlyphState(image);
      }
      if (containerOverlayBlob) {
        const image = await blobToImage(containerOverlayBlob);
        trackUrl(`layer:${CONTAINER_OVERLAY_KEY}`, image);
        if (live) setContainerOverlayState(image);
      }
      if (extractedSubjectBlob) {
        const image = await blobToImage(extractedSubjectBlob);
        trackUrl(`layer:${EXTRACTED_SUBJECT_KEY}`, image);
        if (live) setExtractedSubjectState(image);
      }
      setFrames(restoredFrames);
      if (live) setLoaded(true);
    })();

    return () => {
      live = false;
    };
  }, [trackUrl]);

  /** Persist whatever the compositor produced; canvases become PNG blobs. */
  const persist = useCallback((store: string, key: string, image: CanvasImageSource | null) => {
    const task = (async () => {
    if (!image) return deleteBlob(store, key);
    if (image instanceof HTMLImageElement && /^(data:|blob:)/.test(image.src)) {
      return putBlob(store, key, await (await fetch(image.src)).blob());
    }
    let canvas: HTMLCanvasElement;
    if (image instanceof HTMLCanvasElement) canvas = image;
    else {
      const width = (image as HTMLImageElement).naturalWidth || (image as ImageBitmap).width || 1024;
      const height = (image as HTMLImageElement).naturalHeight || (image as ImageBitmap).height || 1024;
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
    }
    const blob = await canvasToBlobAsync(canvas);
    if (blob) await putBlob(store, key, blob);
    })();
    pending.current.add(task);
    void task.then(() => pending.current.delete(task), () => pending.current.delete(task));
    return task;
  }, []);

  const setMaterial = useCallback(
    (image: CanvasImageSource | null) => {
      setMaterialState(image);
      void persist(LAYERS, MATERIAL_KEY, image);
    },
    [persist],
  );

  const setGlyph = useCallback(
    (image: CanvasImageSource | null) => {
      setGlyphState(image);
      void persist(LAYERS, SINGLE_GLYPH_KEY, image);
    },
    [persist],
  );

  const setContainerOverlay = useCallback(
    (image: CanvasImageSource | null) => {
      setContainerOverlayState(image);
      void persist(LAYERS, CONTAINER_OVERLAY_KEY, image);
    },
    [persist],
  );

  const setExtractedSubject = useCallback(
    (image: CanvasImageSource | null) => {
      setExtractedSubjectState(image);
      void persist(LAYERS, EXTRACTED_SUBJECT_KEY, image);
    },
    [persist],
  );

  const setFrameVariant = useCallback((id: string, image: CanvasImageSource) => {
    setFrames((previous) => new Map(previous).set(id, image));
    void persist(LAYERS, `${FRAME_PREFIX}${id}`, image);
  }, [persist]);

  const clearFrameVariants = useCallback(() => {
    setFrames(new Map());
    for (const [key, url] of urls.current) {
      if (!key.startsWith(`layer:${FRAME_PREFIX}`)) continue;
      URL.revokeObjectURL(url);
      urls.current.delete(key);
    }
    void (async () => {
      for (const key of await allKeys(LAYERS)) {
        if (key.startsWith(FRAME_PREFIX)) await deleteBlob(LAYERS, key);
      }
    })();
  }, []);

  const setItemGlyph = useCallback(
    (id: string, image: CanvasImageSource, revision?: number) => {
      setGlyphs((previous) => new Map(previous).set(id, image));
      void persist(GLYPHS, id, image);
      if (revision) void persist(GLYPHS, `${id}@v${revision}`, image);
    },
    [persist],
  );

  const restoreItemRevision = useCallback(async (id: string, revision: number) => {
    const blob = await getBlob(GLYPHS, `${id}@v${revision}`);
    if (!blob) return false;
    const image = await blobToImage(blob);
    setGlyphs((previous) => new Map(previous).set(id, image));
    await persist(GLYPHS, id, image);
    return true;
  }, [persist]);

  const clearGlyphs = useCallback(() => {
    for (const [key, url] of urls.current) {
      if (key.startsWith('glyph:')) {
        URL.revokeObjectURL(url);
        urls.current.delete(key);
      }
    }
    setGlyphs(new Map());
    void clearStore(GLYPHS);
  }, []);

  const clearItemGlyphs = useCallback((ids: Iterable<string>) => {
    const remove = new Set(ids);
    if (!remove.size) return;
    setGlyphs((previous) => {
      const next = new Map(previous);
      for (const id of remove) next.delete(id);
      return next;
    });
    for (const [key, url] of urls.current) {
      const id = key.startsWith('glyph:') ? key.slice('glyph:'.length).split('@v')[0] : '';
      if (!remove.has(id)) continue;
      URL.revokeObjectURL(url);
      urls.current.delete(key);
    }
    void (async () => {
      for (const key of await allKeys(GLYPHS)) {
        const id = key.split('@v')[0];
        if (remove.has(id)) await deleteBlob(GLYPHS, key);
      }
    })();
  }, []);

  const clearAll = useCallback(() => {
    for (const url of urls.current.values()) URL.revokeObjectURL(url);
    urls.current.clear();
    setGlyphs(new Map());
    setMaterialState(null);
    setGlyphState(null);
    setContainerOverlayState(null);
    setExtractedSubjectState(null);
    setFrames(new Map());
    void clearStore(GLYPHS);
    void (async () => {
      for (const key of await allKeys(LAYERS)) {
        if ([MATERIAL_KEY, SINGLE_GLYPH_KEY, CONTAINER_OVERLAY_KEY, EXTRACTED_SUBJECT_KEY].includes(key) || key.startsWith(FRAME_PREFIX)) await deleteBlob(LAYERS, key);
      }
    })();
  }, []);

  const exportImages = useCallback(async (): Promise<ImageBundle> => {
    await Promise.all([...pending.current]);
    const encoded: Record<string, string> = {};
    const revisions: Record<string, string> = {};
    const encodedFrames: Record<string, string> = {};
    for (const [id, image] of glyphs) {
      const value = await imageDataUrl(image);
      if (value) encoded[id] = value;
    }
    for (const key of await allKeys(GLYPHS)) {
      if (!key.includes('@v')) continue;
      const blob = await getBlob(GLYPHS, key);
      if (blob) revisions[key] = await blobDataUrl(blob);
    }
    for (const [id, image] of frames) {
      const value = await imageDataUrl(image);
      if (value) encodedFrames[id] = value;
    }
    return {
      material: await imageDataUrl(material),
      glyph: await imageDataUrl(glyph),
      glyphs: encoded,
      containerOverlay: await imageDataUrl(containerOverlay),
      extractedSubject: await imageDataUrl(extractedSubject),
      revisions,
      frames: encodedFrames,
    };
  }, [glyphs, material, glyph, containerOverlay, extractedSubject, frames]);

  const importImages = useCallback(async (bundle: ImageBundle) => {
    const glyphEntries = Object.entries(bundle.glyphs ?? {});
    const layerEntries: Array<[string, string]> = [
      [MATERIAL_KEY, bundle.material], [SINGLE_GLYPH_KEY, bundle.glyph],
      [CONTAINER_OVERLAY_KEY, bundle.containerOverlay], [EXTRACTED_SUBJECT_KEY, bundle.extractedSubject],
      ...Object.entries(bundle.frames ?? {}).map(([id, source]) => [`${FRAME_PREFIX}${id}`, source]),
    ].filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    // Decode before changing the working copy; a bad file must not erase it.
    const decoded = await mapArtwork([...glyphEntries, ...layerEntries], async ([id, source]) =>
      [id, await dataUrlImage(source)] as const);
    const blobs = await mapArtwork([...glyphEntries, ...layerEntries, ...Object.entries(bundle.revisions ?? {})],
      async ([id, source]) => [id, await (await fetch(source)).blob()] as const);
    const glyphCount = glyphEntries.length;
    const layerCount = layerEntries.length;
    await Promise.all([...pending.current]);
    await replaceArtwork(
      [...blobs.slice(0, glyphCount), ...blobs.slice(glyphCount + layerCount)],
      blobs.slice(glyphCount, glyphCount + layerCount),
    );
    for (const url of urls.current.values()) URL.revokeObjectURL(url);
    urls.current.clear();
    const restoredLayers = new Map(decoded.slice(glyphCount));
    setGlyphs(new Map(decoded.slice(0, glyphCount)));
    setMaterialState(restoredLayers.get(MATERIAL_KEY) ?? null);
    setGlyphState(restoredLayers.get(SINGLE_GLYPH_KEY) ?? null);
    setContainerOverlayState(restoredLayers.get(CONTAINER_OVERLAY_KEY) ?? null);
    setExtractedSubjectState(restoredLayers.get(EXTRACTED_SUBJECT_KEY) ?? null);
    setFrames(new Map([...restoredLayers].filter(([key]) => key.startsWith(FRAME_PREFIX))
      .map(([key, image]) => [key.slice(FRAME_PREFIX.length), image])));
  }, []);

  return {
    loaded,
    glyphs,
    material,
    glyph,
    containerOverlay,
    extractedSubject,
    frames,
    setMaterial,
    setGlyph,
    setContainerOverlay,
    setExtractedSubject,
    setFrameVariant,
    clearFrameVariants,
    setItemGlyph,
    restoreItemRevision,
    clearGlyphs,
    clearItemGlyphs,
    clearAll,
    exportImages,
    importImages,
  };
}
