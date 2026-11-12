import { CalibrationLabelsSchema, CalibrationLabelSetSchema } from '@/core/schemas';
import type { StorageDeps } from './storageShared';
import type { ParagraphDb } from './db';
export function createCalibrationLabelsRepository(db: ParagraphDb, deps: StorageDeps) {
  const { now, ids, makeAudit } = deps;
  const calibrationLabels = {
    async import(sourceFileName: string, data: unknown) {
      const parsed = CalibrationLabelsSchema.parse(data);
      return db.transaction('rw', db.calibrationLabels, db.auditEvents, async () => {
        const lastAudit = await db.auditEvents.orderBy('at').last();
        const lastLabel = await db.calibrationLabels.orderBy('importedAt').last();
        const at = new Date(
          Math.max(
            Date.parse(now()),
            Date.parse(lastAudit?.at ?? '1970-01-01T00:00:00.000Z') + 1,
            Date.parse(lastLabel?.importedAt ?? '1970-01-01T00:00:00.000Z') + 1,
          ),
        ).toISOString();
        const value = CalibrationLabelSetSchema.parse({
          schemaVersion: 1,
          id: ids(),
          sourceFileName,
          importedAt: at,
          data: parsed,
        });
        await db.calibrationLabels.add(value);
        await db.auditEvents.add({ ...makeAudit(value.id, 'import_labels', 'human'), at });
        return value;
      });
    },
    async list() {
      return (await db.calibrationLabels.toArray())
        .map((item) => CalibrationLabelSetSchema.parse(item))
        .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    },
    async delete(id: string) {
      await db.calibrationLabels.delete(id);
    },
  };
  return calibrationLabels;
}
