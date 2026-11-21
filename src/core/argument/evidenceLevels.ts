import { z } from 'zod';
import type { Argument } from '../schemas';

// Paraphrased from Writing Bank evidence-levels (data/banks/evidence-levels/levels.json, docs/AUTHORING.md).
// A level describes properties of the support, not a ranking of study designs. Change the scale here only.
export const EVIDENCE_LEVELS = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5'] as const;
export const EvidenceLevelSchema = z.enum(EVIDENCE_LEVELS);
export type EvidenceLevel = z.infer<typeof EvidenceLevelSchema>;
export const EVIDENCE_LEVEL_INFO: Record<EvidenceLevel, { label: string; definition: string; vi: string }> = {
  E0: {
    label: 'None',
    definition:
      'no evidence is given: no data, citation or derivation; the claim is asserted or treated as common knowledge.',
    vi: 'Không có evidence: không dữ liệu, trích dẫn hay suy diễn.',
  },
  E1: {
    label: 'Illustrative',
    definition:
      'instances with no systematic comparison, such as one run, a case, a demonstration, selected examples or expert opinion.',
    vi: 'Minh họa: một lần chạy, một trường hợp, ví dụ chọn lọc, không so sánh có hệ thống.',
  },
  E2: {
    label: 'Systematic, uncontrolled',
    definition:
      'data collected systematically, but associational, or a comparison whose conditions were not controlled or whose variation was not estimated (one benchmark without variance, baselines copied from other papers, a survey, a cross-sectional study).',
    vi: 'Có hệ thống nhưng không kiểm soát: một benchmark không có phương sai, khảo sát, nghiên cứu cắt ngang.',
  },
  E3: {
    label: 'Controlled comparison with uncertainty',
    definition:
      'things compared under the same conditions, or with known confounders adjusted, and the result reported with uncertainty (intervals, variance across runs, a named statistical test).',
    vi: 'So sánh có kiểm soát, kèm độ bất định: khoảng tin cậy, phương sai qua nhiều lần chạy, kiểm định.',
  },
  E4: {
    label: 'Factor isolated',
    definition:
      'the design isolates the factor, so the outcome difference can be attributed to it: random assignment, changing exactly one thing in an otherwise identical system (a full ablation with tuned baselines), or an identifying design with tested assumptions.',
    vi: 'Cô lập được yếu tố: phân nhóm ngẫu nhiên, ablation đầy đủ với baseline được tinh chỉnh.',
  },
  E5: {
    label: 'Replicated, synthesised or proven',
    definition:
      'the finding is reproduced by independent work, established by a systematic synthesis of sound studies, or, for a formal claim, a complete proof is given.',
    vi: 'Được lặp lại độc lập, tổng hợp có hệ thống, hoặc có chứng minh đầy đủ.',
  },
};

type Graded = Pick<Argument, 'importance' | 'evidenceLevel'>;

/**
 * Shares of E0–E5 over the main claims of several papers, pooled. Pass each paper's live arguments (not
 * dismissed by the reader). Main claims without a level are left out of the shares and counted in `missing`.
 * With no graded claim every share is 0. The levels are machine labels.
 */
export function evidenceLevelDistribution(papers: readonly { arguments: readonly Graded[] }[]) {
  const counts = Object.fromEntries(EVIDENCE_LEVELS.map((level) => [level, 0])) as Record<
    EvidenceLevel,
    number
  >;
  let missing = 0;
  let papersWithLevel = 0;
  for (const paper of papers) {
    let graded = false;
    for (const item of paper.arguments) {
      if (item.importance !== 'main') continue;
      if (item.evidenceLevel) {
        counts[item.evidenceLevel]++;
        graded = true;
      } else missing++;
    }
    if (graded) papersWithLevel++;
  }
  const counted = EVIDENCE_LEVELS.reduce((sum, level) => sum + counts[level], 0);
  const shares = Object.fromEntries(
    EVIDENCE_LEVELS.map((level) => [level, counted ? counts[level] / counted : 0]),
  ) as Record<EvidenceLevel, number>;
  return { shares, counts, counted, missing, papers: papers.length, papersWithLevel };
}
