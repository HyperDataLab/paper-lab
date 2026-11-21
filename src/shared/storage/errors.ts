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

export class RemoteStorageError extends Error {
  override name = 'RemoteStorageError';
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
  }
}

export class DataNotConfiguredError extends RemoteStorageError {
  override name = 'DataNotConfiguredError';
  constructor(detail: string) {
    super(503, 'data_not_configured', detail);
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
    public version: number | null,
    id = '',
  ) {
    super('corpora', id, version, 'Corpus đã được người khác sửa');
  }
}

/** The lab store refused a write because another live record holds the same unique value (a library DOI). */
export class UniqueConflictError extends RemoteStorageError {
  override name = 'UniqueConflictError';
  constructor(detail = 'Another live record has the same DOI.') {
    super(409, 'unique_conflict', detail);
  }
}

/** A DOI that is already in the Library. */
export class DuplicateDoiError extends Error {
  override name = 'DuplicateDoiError';
  constructor(cause?: unknown) {
    super('DOI này đã có trong Library.', { cause });
  }
}
