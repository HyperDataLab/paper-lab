import type { ParagraphDb } from './db';

/** An original PDF kept in this browser, named by its SHA-256 (hex, without the "sha256:" prefix). */
export interface PdfFileRecord {
  sha256: string;
  blob: Blob;
  size: number;
  savedAt: string;
  /** True once the lab's storage has confirmed it holds the file. */
  uploaded: boolean;
}

export function createPdfFilesRepository(db: ParagraphDb, now: () => string) {
  return {
    get: (sha256: string) => db.pdfFiles.get(sha256),
    async put(sha256: string, blob: Blob, uploaded = false) {
      const previous = await db.pdfFiles.get(sha256);
      const record: PdfFileRecord = {
        sha256,
        blob,
        size: blob.size,
        savedAt: now(),
        uploaded: uploaded || Boolean(previous?.uploaded),
      };
      await db.pdfFiles.put(record);
      return record;
    },
    async markUploaded(sha256: string) {
      await db.pdfFiles.update(sha256, { uploaded: true });
    },
    pending: () => db.pdfFiles.filter((record) => !record.uploaded).toArray(),
  };
}
