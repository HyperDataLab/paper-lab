import { AuditEventSchema, type AuditEvent } from '@/core/schemas';
import { readAudit } from './storageShared';
import type { DocReader, DocStore } from './docStore';
import { DataNotConfiguredError } from './errors';
export function createAuditRepository(localStore: DocStore, remoteStore?: () => DocReader | undefined) {
  async function remoteEvents(id?: string, latest = false) {
    const remote = remoteStore?.();
    if (!remote) return [];
    try {
      return (
        await remote.query('auditEvents', {
          where: id ? { refId: id } : undefined,
          orderBy: 'at',
          desc: latest,
          limit: latest ? 1 : undefined,
        })
      ).map(({ doc }) => AuditEventSchema.parse(doc));
    } catch (error) {
      if (error instanceof DataNotConfiguredError) return [];
      throw error;
    }
  }
  function merge(local: AuditEvent[], lab: AuditEvent[]) {
    return [...new Map([...local, ...lab].map((event) => [event.id, event])).values()].sort((a, b) =>
      a.at.localeCompare(b.at),
    );
  }
  const audit = {
    async latestAt(id?: string) {
      const query = { where: id ? { refId: id } : undefined, orderBy: 'at', desc: true, limit: 1 };
      const [[local], [lab]] = await Promise.all([
        localStore.query('auditEvents', query),
        remoteEvents(id, true),
      ]);
      return [local && AuditEventSchema.parse(local.doc).at, lab?.at]
        .filter((at) => at !== undefined)
        .sort()
        .at(-1);
    },
    async append(event: AuditEvent) {
      const value = AuditEventSchema.parse(event);
      await localStore.put('auditEvents', value.id, value, null);
    },
    async listAll() {
      const { values, corrupt } = await readAudit(localStore);
      return { items: merge(values, await remoteEvents()), corrupt };
    },
    async listByAnalysis(id: string) {
      const { values, corrupt } = await readAudit(localStore, id);
      return { items: merge(values, await remoteEvents(id)), corrupt };
    },
  };
  return audit;
}
