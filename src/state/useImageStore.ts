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
      if (live) setLoaded(true);
    })();

    return () => {
      live = false;
    };
  }, [trackUrl]);

  /** Persist whatever the compositor produced; canvases become PNG blobs. */
  const persist = useCallback(async (store: string, key: string, image: CanvasImageSource | null) => {
    if (!image) return deleteBlob(store, key);
    if (!(image instanceof HTMLCanvasElement)) return;
    const blob = await canvasToBlobAsync(image);
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

  const setItemGlyph = useCallback(
    (id: string, image: CanvasImageSource) => {
      setGlyphs((previous) => new Map(previous).set(id, image));
      void persist(GLYPHS, id, image);
    },
    [persist],
  );

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

  const clearAll = useCallback(() => {
    for (const url of urls.current.values()) URL.revokeObjectURL(url);
    urls.current.clear();
    setGlyphs(new Map());
    setMaterialState(null);
    setGlyphState(null);
    void clearStore(GLYPHS);
    void clearStore(LAYERS);
  }, []);

  return {
    loaded,
    glyphs,
    material,
    glyph,
    setMaterial,
    setGlyph,
    setItemGlyph,
    clearGlyphs,
    clearAll,
  };
}
