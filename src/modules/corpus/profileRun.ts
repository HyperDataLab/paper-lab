import { buildCorpusProfile, profileEligible, type ProfilePaper } from '@/core/corpusProfile/profile';
import { buildPaperModel } from '@/core/paperModel';
import type { Corpus } from '@/core/schemas/corpus';
import { CorpusProfileSchema, type CorpusProfile } from '@/core/schemas/corpusProfile';
import type { Repositories } from '@/shared/storage/repositories';
import { labelMembers, loadLabelPaper } from './labelRun';

/** Members' papers, models and label records, read the way the labelling coverage reads them. */
export async function loadProfilePapers(corpus: Corpus, repo: Repositories, into: Map<string, ProfilePaper>) {
  const members = labelMembers(corpus).filter(profileEligible);
  await Promise.all(
    members.map(async (member) => {
      const item = await loadLabelPaper(member, repo);
      if (!item) return;
      const context = await repo.paperContext.get(item.paper.id);
      const model = buildPaperModel({
        paper: item.paper,
        metadata: context?.metadata ?? null,
        insights: item.insights,
        stance: item.stance,
        now: new Date(0),
      });
      into.set(member.memberId, { model, insights: item.insights, stance: item.stance });
    }),
  );
}

/** A 32-bit seed from the target's sampling seed, so the same corpus gives the same bootstrap. */
export function profileSeed(target: Corpus): number {
  const body = target.protocol.at(-1)?.body;
  const text = body && 'seed' in body && body.seed ? body.seed : target.id;
  let hash = 0x811c9dc5;
  for (const char of text) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  return hash;
}

export async function computeProfile(target: Corpus, control: Corpus, repo: Repositories) {
  const papers = new Map<string, ProfilePaper>();
  await loadProfilePapers(target, repo, papers);
  await loadProfilePapers(control, repo, papers);
  return buildCorpusProfile({ target, control, papers, seed: profileSeed(target), now: new Date() });
}

const sectionNames: Record<string, string> = {
  ABSTRACT: 'Tóm tắt',
  INTRODUCTION: 'Mở đầu',
  RELATED_WORK: 'Nghiên cứu liên quan',
  METHODS: 'Phương pháp',
  RESULTS: 'Kết quả',
  DISCUSSION: 'Bàn luận',
  CONCLUSION: 'Kết luận',
  OTHER: 'Khác',
  APPENDIX: 'Phụ lục',
};

export function featureLabel(featureId: string): string {
  const [head, middle, tail] = featureId.split('.');
  if (head === 'section' && middle)
    return `${tail === 'word_share' ? 'Tỷ lệ từ' : 'Độ dài câu'} · ${sectionNames[middle] ?? middle}`;
  if (featureId === 'paragraph.length') return 'Độ dài đoạn';
  if (featureId === 'citation.rate') return 'Mật độ trích dẫn';
  if (head === 'stance') return `Stance: ${middle}`;
  if (head === 'rhetoric') return `Có nhãn ${middle}`;
  if (head === 'claim') return `Tỷ lệ claim ${middle}`;
  return featureId;
}

/** Downloads the validated profile as `<slug>.corpus-profile.json`. */
export function downloadProfile(profile: CorpusProfile, title: string) {
  const json = JSON.stringify(CorpusProfileSchema.parse(profile), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${
    title
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'corpus'
  }.corpus-profile.json`;
  link.click();
  URL.revokeObjectURL(url);
}
