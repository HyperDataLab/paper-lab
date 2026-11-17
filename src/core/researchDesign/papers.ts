/** M2 maps PaperLab project papers to this seam; ids become project paper keys. */
export interface Paper {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  decision: 'undecided' | 'included' | 'excluded';
  reason: string | null;
  addedBy: string;
  addedAt: string;
  model: {
    paperlab: { paperId: string; etag: string } | null;
    sourceHash: string | null;
    sentences: number;
    importedBy: string;
    importedAt: string;
  } | null;
}
export interface PapersDoc {
  schemaVersion: 1;
  papers: Paper[];
  log: {
    at: string;
    by: string;
    paperId: string;
    action: 'added' | 'included' | 'excluded' | 'undecided' | 'model_imported';
    reason: string | null;
  }[];
}

/** The fields read by Research Design are a subset of PaperLab's PaperModel. */
export interface PaperModelView {
  format: 'paperlab-paper-model';
  schemaVersion: 1;
  document: {
    source: { kind: string; sha256: string | null; pageCount: number | null };
    metadata: {
      title: string;
      authors: string[];
      doi: string | null;
      year: number | null;
      venue: string | null;
    };
    sections: { id: string; parentId: string | null; title: string; level: number; role: string }[];
    blocks: { id: string; sectionId: string; kind: string; page: number | null; text: string }[];
  };
  sentences: { key: string; displayId: string; sectionId: string; page: number | null; text: string }[];
}
