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
} from '../core/store';

const MATERIAL_KEY = 'material';
const SINGLE_GLYPH_KEY = 'glyph';
const FRAME_PREFIX = 'frame:';
const CONTAINER_OVERLAY_KEY = 'container-overlay';

export interface ImageBundle {
  material: string | null;
  glyph: string | null;
  glyphs: Record<string, string>;
  containerOverlay?: string | null;
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

function imageDataUrl(image: CanvasImageSource | null): string | null {
  if (!image) return null;
  const width = (image as HTMLImageElement).naturalWidth || (image as HTMLCanvasElement).width || 1024;
  const height = (image as HTMLImageElement).naturalHeight || (image as HTMLCanvasElement).height || 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/png');
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
  const [frames, setFrames] = useState<Map<string, CanvasImageSource>>(new Map());
  const urls = useRef(new Map<string, string>());

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
      setFrames(restoredFrames);
      if (live) setLoaded(true);
    })();

    return () => {
      live = false;
    };
  }, [trackUrl]);

  /** Persist whatever the compositor produced; canvases become PNG blobs. */
  const persist = useCallback(async (store: string, key: string, image: CanvasImageSource | null) => {
    if (!image) return deleteBlob(store, key);
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
    setFrames(new Map());
    void clearStore(GLYPHS);
    void clearStore(LAYERS);
  }, []);

  const exportImages = useCallback(async (): Promise<ImageBundle> => {
    const encoded: Record<string, string> = {};
    const revisions: Record<string, string> = {};
    const encodedFrames: Record<string, string> = {};
    for (const [id, image] of glyphs) {
      const value = imageDataUrl(image);
      if (value) encoded[id] = value;
    }
    for (const key of await allKeys(GLYPHS)) {
      if (!key.includes('@v')) continue;
      const blob = await getBlob(GLYPHS, key);
      if (blob) revisions[key] = await blobDataUrl(blob);
    }
    for (const [id, image] of frames) {
      const value = imageDataUrl(image);
      if (value) encodedFrames[id] = value;
    }
    return {
      material: imageDataUrl(material),
      glyph: imageDataUrl(glyph),
      glyphs: encoded,
      containerOverlay: imageDataUrl(containerOverlay),
      revisions,
      frames: encodedFrames,
    };
  }, [glyphs, material, glyph, containerOverlay, frames]);

  const importImages = useCallback(async (bundle: ImageBundle) => {
    await clearStore(GLYPHS);
    await clearStore(LAYERS);
    const restored = new Map<string, CanvasImageSource>();
    for (const [id, source] of Object.entries(bundle.glyphs ?? {})) {
      const image = await dataUrlImage(source);
      restored.set(id, image);
      await persist(GLYPHS, id, image);
    }
    for (const [key, source] of Object.entries(bundle.revisions ?? {})) {
      const response = await fetch(source);
      await putBlob(GLYPHS, key, await response.blob());
    }
    const nextMaterial = bundle.material ? await dataUrlImage(bundle.material) : null;
    const nextGlyph = bundle.glyph ? await dataUrlImage(bundle.glyph) : null;
    const nextContainerOverlay = bundle.containerOverlay ? await dataUrlImage(bundle.containerOverlay) : null;
    const nextFrames = new Map<string, CanvasImageSource>();
    for (const [id, source] of Object.entries(bundle.frames ?? {})) {
      const image = await dataUrlImage(source);
      nextFrames.set(id, image);
      await persist(LAYERS, `${FRAME_PREFIX}${id}`, image);
    }
    setGlyphs(restored);
    setMaterialState(nextMaterial);
    setGlyphState(nextGlyph);
    setContainerOverlayState(nextContainerOverlay);
    setFrames(nextFrames);
    await persist(LAYERS, MATERIAL_KEY, nextMaterial);
    await persist(LAYERS, SINGLE_GLYPH_KEY, nextGlyph);
    await persist(LAYERS, CONTAINER_OVERLAY_KEY, nextContainerOverlay);
  }, [persist]);

  return {
    loaded,
    glyphs,
    material,
    glyph,
    containerOverlay,
    frames,
    setMaterial,
    setGlyph,
    setContainerOverlay,
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
