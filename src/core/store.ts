/**
 * IndexedDB blob store for rendered layers.
 *
 * localStorage cannot hold this: a single 1024px PNG is a few hundred KB as a
 * data URL, the quota is around 5MB, and a family is hundreds of icons. IndexedDB
 * stores Blobs natively — no base64 inflation — and has no practical size cap at
 * this scale.
 *
 * Every call degrades to a no-op rather than throwing. Private-mode browsers can
 * refuse to open a database at all, and losing a session's renders is a far
 * better outcome than an app that will not start.
 */

const DB_NAME = 'icon-generator';
const DB_VERSION = 2;

/** Per-library-card glyphs, keyed by item id. */
export const GLYPHS = 'glyphs';
/** Single-icon layers and anything else global, keyed by a fixed name. */
export const LAYERS = 'layers';
/** Deduplicated model results, keyed by a hash of model + exact input. */
export const GENERATION_CACHE = 'generation-cache';

let connection: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (connection) return connection;

  connection = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GLYPHS)) db.createObjectStore(GLYPHS);
      if (!db.objectStoreNames.contains(LAYERS)) db.createObjectStore(LAYERS);
      if (!db.objectStoreNames.contains(GENERATION_CACHE)) db.createObjectStore(GENERATION_CACHE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return connection;
}

function transact<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        let request: IDBRequest<T>;
        try {
          request = run(db.transaction(store, mode).objectStore(store));
        } catch {
          return resolve(null);
        }
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      }),
  );
}

export const putBlob = (store: string, key: string, blob: Blob) =>
  transact(store, 'readwrite', (objectStore) => objectStore.put(blob, key));

export const getBlob = (store: string, key: string) =>
  transact<Blob | undefined>(store, 'readonly', (objectStore) => objectStore.get(key)).then(
    (value) => (value instanceof Blob ? value : null),
  );

export const deleteBlob = (store: string, key: string) =>
  transact(store, 'readwrite', (objectStore) => objectStore.delete(key));

export const allKeys = (store: string) =>
  transact<IDBValidKey[]>(store, 'readonly', (objectStore) => objectStore.getAllKeys()).then(
    (keys) => (keys ?? []).map(String),
  );

export const clearStore = (store: string) =>
  transact(store, 'readwrite', (objectStore) => objectStore.clear());

/** Drop stored glyphs whose card no longer exists, so the store cannot grow forever. */
export async function pruneGlyphs(keep: Set<string>) {
  for (const key of await allKeys(GLYPHS)) {
    if (!keep.has(key)) await deleteBlob(GLYPHS, key);
  }
}

export function canvasToBlobAsync(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

/** Decode a stored blob back into something the compositor can draw. */
export function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Stored image could not be decoded.'));
    };
    image.src = url;
  });
}
