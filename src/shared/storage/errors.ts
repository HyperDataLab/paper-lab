/** A write lost a race: the stored document moved on since it was read. */
export class StorageConflictError extends Error {
  override name = 'StorageConflictError';
  constructor(
    readonly collection: string,
    readonly id: string,
    readonly serverVersion: number | string | null,
    message = `${collection}/${id} changed`,
  ) {
    super(message);
  }
}

export class ResearchDesignConflictError extends StorageConflictError {
  override name = 'ResearchDesignConflictError';
  constructor(message = 'Research design changed', id = '', serverVersion: number | null = null) {
    super('researchDesigns', id, serverVersion, message);
  }
}

export class AutoResearchConflictError extends StorageConflictError {
  override name = 'AutoResearchConflictError';
  constructor(message = 'AutoResearch run changed', id = '', serverVersion: number | null = null) {
    super('autoresearchRuns', id, serverVersion, message);
  }
}

/** The lab's copy of a corpus moved on; `version` is the server's version, if it still exists. */
export class CorpusConflict extends StorageConflictError {
  override name = 'CorpusConflict';
  constructor(
    public version: string | null,
    id = '',
  ) {
    super('corpora', id, version, 'Corpus đã được người khác sửa');
  }
}
