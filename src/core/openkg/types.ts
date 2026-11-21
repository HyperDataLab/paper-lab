import type { ArgumentRun, LibraryItem, Paper, PaperModel, ScgPaperRun } from '../schemas';

export const KG_BASE = 'https://hyperdatalab-paragraph-lab.web.app/kg/';
export const KG_LAYERS = ['evidential', 'conceptual', 'disciplinary', 'expertise', 'normative'] as const;
export type KgLayer = (typeof KG_LAYERS)[number];
export type KgProvenance = 'openalex' | 'paper_text' | 'llm_candidate' | 'accepted';
export type KgNodeType =
  | 'Paper'
  | 'Work'
  | 'Source'
  | 'Keyword'
  | 'Contribution'
  | 'Prerequisite'
  | 'Tool'
  | 'Domain'
  | 'Field'
  | 'Subfield'
  | 'Topic'
  | 'Author'
  | 'Institution'
  | 'Claim'
  | 'Evidence'
  | 'EvidenceLevel';
export type KgPredicate =
  | 'cites'
  | 'publishedIn'
  | 'hasKeyword'
  | 'contributes'
  | 'buildsOn'
  | 'relatedKeyword'
  | 'coAuthor'
  | 'inTopic'
  | 'broader'
  | 'authoredBy'
  | 'affiliatedWith'
  | 'hasClaim'
  | 'supportedBy'
  | 'evidenceLevel';
export type KgAttribute =
  | 'doi'
  | 'openalexId'
  | 'orcid'
  | 'ror'
  | 'country'
  | 'year'
  | 'score'
  | 'salience'
  | 'description'
  | 'review'
  | 'evidenceBasis';
export type KgValue = string | number | boolean;

export interface KgNode {
  id: string;
  type: KgNodeType;
  label: string;
  layer: KgLayer;
  attrs: Partial<Record<KgAttribute, KgValue>>;
}

export interface KgEdge {
  s: string;
  p: KgPredicate;
  o: string;
  layer: KgLayer;
  provenance: KgProvenance;
  evidence?: string[];
  keywordScore?: number;
  weight?: number;
  supportCount?: number;
  support?: KgSupport[];
}

export interface KgSupport {
  paper: string;
  sourcePaper?: string;
  provenance: KgProvenance;
  evidence?: string[];
}

export interface PaperKg {
  nodes: KgNode[];
  edges: KgEdge[];
}

export interface PaperKgInput {
  paper: Paper;
  model?: PaperModel;
  library?: LibraryItem;
  scgRun?: ScgPaperRun;
  argumentRun?: ArgumentRun;
}

export function kgIri(...segments: string[]): string {
  return (
    KG_BASE +
    segments.map((segment) => encodeURIComponent(segment.replace(/[\uD800-\uDFFF]/gu, '\uFFFD'))).join('/')
  );
}
