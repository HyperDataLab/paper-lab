import type { Bucket } from '../deps';

interface StoredObject {
  bytes: Uint8Array;
  etag: string;
  uploaded: Date;
  customMetadata: Record<string, string>;
}

/** An in-memory R2 bucket with the conditional puts, listing pages and deletes the data store uses. */
export function memoryBucket(now: () => Date = () => new Date()) {
  const objects = new Map<string, StoredObject>();
  let counter = 0;
  const bucket: Required<Bucket> = {
    async head(key) {
      const object = objects.get(key);
      return object ? { etag: object.etag, customMetadata: object.customMetadata } : null;
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        body: new Response(object.bytes.slice()).body as ReadableStream,
        size: object.bytes.byteLength,
        etag: object.etag,
      };
    },
    async list({ prefix, cursor, limit = 1000 }) {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      const start = cursor ? keys.findIndex((key) => key > cursor) : 0;
      const page = start < 0 ? [] : keys.slice(start, start + limit);
      const truncated = start >= 0 && start + limit < keys.length;
      return {
        objects: page.map((key) => {
          const object = objects.get(key) as StoredObject;
          return { key, etag: object.etag, uploaded: object.uploaded, customMetadata: object.customMetadata };
        }),
        truncated,
        cursor: truncated ? page.at(-1) : undefined,
      };
    },
    async put(key, value, options) {
      const existing = objects.get(key);
      if (options.onlyIf?.etagDoesNotMatch === '*' && existing) return null;
      if (options.onlyIf?.etagMatches && existing?.etag !== options.onlyIf.etagMatches) return null;
      const etag = `etag-${++counter}`;
      objects.set(key, {
        bytes: new Uint8Array(value.slice(0)),
        etag,
        uploaded: now(),
        customMetadata: options.customMetadata,
      });
      return { etag };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
  };
  return { bucket, objects };
}
