import type { Issue } from '../schemas/issue';
import type { FlowLink, Paragraph } from '../schemas/paragraph';
import type { TextAnalysis } from '../schemas/text';

/** Relations that do not justify a topic shift: `none`, and `other` without a named relation (S8 G1). */
const WEAK_RELATIONS: ReadonlySet<FlowLink['discourseRelation']> = new Set(['none', 'other']);
export const FLOW_BREAK_MIN_CONFIDENCE = 0.5;

export function isUnexplainedShift(link: FlowLink): boolean {
  return link.continuity === 'shift' && WEAK_RELATIONS.has(link.discourseRelation);
}
export function hasNamedRelation(link: FlowLink): boolean {
  return !WEAK_RELATIONS.has(link.discourseRelation);
}

const label = (id: string) => id.toUpperCase();
function withRationale(base: string, rationale: string | null | undefined): string {
  const extra = rationale?.trim();
  return extra && extra !== 'no model output' ? `${base} Nhận xét của AI: ${extra}` : base;
}

function flowIssue(link: FlowLink, text: TextAnalysis): Issue | null {
  // A pair without model output (confidence 0) carries no evidence, so it never becomes a finding.
  if (link.confidence <= 0 || !isUnexplainedShift(link)) return null;
  const from = text.sentences.find((sentence) => sentence.id === link.fromSentenceId);
  const to = text.sentences.find((sentence) => sentence.id === link.toSentenceId);
  if (!from || !to) return null;
  const flowBreak = !link.linked && link.confidence >= FLOW_BREAK_MIN_CONFIDENCE;
  const type = flowBreak ? 'FLOW_BREAK_CANDIDATE' : 'UNEXPLAINED_TOPIC_SHIFT';
  const first = link.fromSpan ?? from;
  const second = link.toSpan ?? to;
  const [a, b] = [label(from.id), label(to.id)];
  return {
    id: `${type}:${from.id}-${to.id}:${first.start}-${second.end}`,
    type,
    category: 'flow',
    findingKind: 'review_candidate',
    status: 'candidate',
    severity: flowBreak ? 'moderate' : 'minor',
    spans: [
      {
        start: first.start,
        end: first.end,
        role: link.fromSpan ? 'stress_from' : 'sentence_from',
        sentenceId: from.id,
      },
      {
        start: second.start,
        end: second.end,
        role: link.toSpan ? 'topic_to' : 'sentence_to',
        sentenceId: to.id,
      },
    ],
    sentenceIds: [from.id, to.id],
    metric: { name: 'stress_to_next_topic_alignment', value: 0, unit: 'pair' },
    why: withRationale(
      flowBreak
        ? `Phần nhấn cuối câu ${a} không dẫn sang chủ đề đầu câu ${b}; người đọc phải tự nối hai ý.`
        : `Câu ${b} chuyển sang chủ đề mới mà chưa nêu rõ quan hệ với câu ${a}.`,
      link.rationale,
    ),
    suggestedFix: flowBreak
      ? `Cân nhắc mở câu ${b} bằng thông tin vừa nhấn ở câu ${a}, hoặc thêm từ nối nêu rõ quan hệ — không thêm dữ kiện mới.`
      : `Cân nhắc thêm từ nối cho biết câu ${b} liên hệ thế nào với câu ${a} (ví dụ, nguyên nhân, đối lập…) — không thêm dữ kiện mới.`,
    sourcePrinciple: 'Schimel Ch. 13',
    confidence: link.confidence,
  };
}

export function paragraphIssues(
  paragraph: Paragraph,
  links: FlowLink[],
  text: TextAnalysis,
  roles: { sentenceId: string; rationale: string | null }[] = [],
): Issue[] {
  const issues: Issue[] = [];
  for (const link of links) {
    const found = flowIssue(link, text);
    if (found) issues.push(found);
  }
  for (const id of paragraph.unity.offTopicSentenceIds) {
    const sentence = text.sentences.find((item) => item.id === id);
    if (!sentence) continue;
    issues.push({
      id: `OFF_TOPIC_SENTENCE:${id}:${sentence.start}-${sentence.end}`,
      type: 'OFF_TOPIC_SENTENCE',
      category: 'organization',
      findingKind: 'review_candidate',
      status: 'candidate',
      severity: 'moderate',
      spans: [{ start: sentence.start, end: sentence.end, role: 'sentence', sentenceId: id }],
      sentenceIds: [id],
      metric: { name: 'off_topic_sentence_count', value: 1, unit: 'sentence' },
      why: withRationale(
        `Câu ${label(id)} có thể không phục vụ ý chính của đoạn, làm đoạn kém thống nhất.`,
        roles.find((role) => role.sentenceId === id)?.rationale ?? paragraph.unity.rationale,
      ),
      suggestedFix: `Cân nhắc nối câu ${label(id)} với ý chính, chuyển sang đoạn khác, hoặc bỏ nếu không cần — giữ nguyên dữ kiện.`,
      sourcePrinciple: 'Schimel Ch. 11',
      confidence: paragraph.confidence,
    });
  }
  const central =
    text.sentences.find((sentence) => sentence.id === paragraph.centralPoint.sentenceId) ?? text.sentences[0];
  if (central && paragraph.centralPoint.identifiability <= 1)
    issues.push({
      id: `CENTRAL_POINT_WEAK:${central.id}:${central.start}-${central.end}`,
      type: 'CENTRAL_POINT_WEAK',
      category: 'organization',
      findingKind: 'review_candidate',
      status: 'candidate',
      severity: 'major',
      spans: [{ start: central.start, end: central.end, role: 'central_point', sentenceId: central.id }],
      sentenceIds: [central.id],
      metric: {
        name: 'central_point_identifiability',
        value: paragraph.centralPoint.identifiability,
        unit: null,
      },
      why: withRationale(
        paragraph.centralPoint.sentenceId
          ? `Ý chính của đoạn (câu ${label(central.id)}) chưa được nêu rõ; người đọc khó biết đoạn muốn khẳng định điều gì.`
          : 'Đoạn chưa có câu nêu ý chính rõ ràng; người đọc khó biết đoạn muốn khẳng định điều gì.',
        paragraph.centralPoint.evidence,
      ),
      suggestedFix:
        'Cân nhắc nêu ý chính bằng một câu trực tiếp, thường ở đầu đoạn, rồi để các câu sau phát triển ý đó — không thêm kết luận mới.',
      sourcePrinciple: 'Schimel Ch. 11',
      confidence: paragraph.confidence,
    });
  return issues;
}
