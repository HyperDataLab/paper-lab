import { classifyGap, isDeepClause } from '../analysis/heuristics';
import { ISSUE_CATEGORY, type Issue, type SentenceAnnotation, type TextAnalysis } from '../schemas';
import { DEFAULT_LEXICON, type Lexicon } from './lexicons';
export * from './lexicons';
export * from './applyJudgement';
export * from './mergeHumanDecisions';

type FindingType =
  | 'FUZZY_VERB'
  | 'NOMINALIZATION'
  | 'WEAK_MODIFIER'
  | 'UNSUPPORTED_INTENSIFIER'
  | 'REDUNDANT_PHRASE'
  | 'METADISCOURSE'
  | 'SUBJECT_VERB_GAP'
  | 'CLAUSE_DEPTH';
const explanations: Record<FindingType, { why: string; suggestedFix: string }> = {
  SUBJECT_VERB_GAP: {
    why: 'Cụm xen giữa dài tách chủ ngữ khỏi động từ chính; người đọc phải giữ chủ ngữ trong đầu lâu hơn.',
    suggestedFix: 'Cân nhắc chuyển cụm xen giữa ra sau động từ chính nếu không đổi nghĩa.',
  },
  CLAUSE_DEPTH: {
    why: 'Nhiều lớp mệnh đề có thể khiến quan hệ giữa các ý khó theo dõi.',
    suggestedFix: 'Cân nhắc tách hoặc sắp xếp lại các mệnh đề nếu giữ nguyên ý nghĩa.',
  },
  FUZZY_VERB: {
    why: 'Động từ này có thể chưa diễn tả cụ thể hành động.',
    suggestedFix: 'Cân nhắc dùng động từ cụ thể hơn nếu phù hợp với ngữ cảnh.',
  },
  NOMINALIZATION: {
    why: 'Danh từ hóa có thể che khuất hành động được mô tả.',
    suggestedFix: 'Cân nhắc diễn đạt hành động bằng động từ nếu giữ nguyên ý nghĩa.',
  },
  WEAK_MODIFIER: {
    why: 'Từ bổ nghĩa này có thể không thêm thông tin cụ thể.',
    suggestedFix: 'Cân nhắc bỏ hoặc thay từ bổ nghĩa nếu không đổi mức độ khẳng định.',
  },
  UNSUPPORTED_INTENSIFIER: {
    why: 'Từ nhấn mạnh mức độ có thể cần bằng chứng định lượng trong ngữ cảnh.',
    suggestedFix: 'Cân nhắc bổ sung con số hỗ trợ từ dữ liệu của bạn, không tự tạo số liệu.',
  },
  REDUNDANT_PHRASE: {
    why: 'Cụm từ này có thể diễn đạt ngắn gọn hơn.',
    suggestedFix: 'Cân nhắc rút gọn cụm từ nếu giữ nguyên ý nghĩa.',
  },
  METADISCOURSE: {
    why: 'Cụm dẫn nhập này có thể làm chậm ý chính.',
    suggestedFix: 'Cân nhắc bỏ cụm dẫn nhập nếu giữ nguyên ý nghĩa.',
  },
};
function issue(
  type: FindingType,
  sentenceId: string,
  span: { start: number; end: number },
  role: string,
): Issue {
  const stylistic = type === 'REDUNDANT_PHRASE' || type === 'METADISCOURSE';
  return {
    id: `${type}:${sentenceId}:${span.start}-${span.end}`,
    type,
    category: ISSUE_CATEGORY[type],
    findingKind: stylistic ? 'stylistic_suggestion' : 'review_candidate',
    status: 'candidate',
    severity: 'minor',
    spans: [{ start: span.start, end: span.end, role }],
    sentenceIds: [sentenceId],
    metric: { name: `${type.toLowerCase()}_candidates`, value: 1, unit: 'candidate' },
    ...explanations[type],
    sourcePrinciple:
      type === 'SUBJECT_VERB_GAP'
        ? 'Schimel Ch. 12, §12.4'
        : type === 'CLAUSE_DEPTH'
          ? 'Schimel Ch. 12'
          : type === 'FUZZY_VERB' || type === 'NOMINALIZATION'
            ? 'Schimel Ch. 14, §14.2'
            : stylistic
              ? 'Schimel Ch. 16'
              : 'Schimel Ch. 16, §16.4',
    confidence: 0.5,
  };
}
export function detectLexical(
  text: TextAnalysis,
  annotations: SentenceAnnotation[] | null,
  lexicon = DEFAULT_LEXICON,
): Issue[] {
  const issues: Issue[] = [];
  for (const sentence of text.sentences) {
    const tokens = text.tokens.slice(sentence.tokenStart, sentence.tokenEnd);
    const words = tokens.map((t) => t.text.toLowerCase());
    const annotation = annotations?.find((a) => a.sentenceId === sentence.id);
    const matches = (at: number, phrase: string) =>
      phrase.split(' ').every((word, i) => words[at + i] === word);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token) continue;
      const word = words[i] ?? '';
      for (const phrase of lexicon.fuzzyVerbs) {
        if (!matches(i, phrase)) continue;
        if (['have', 'has', 'had', 'having', 'do', 'does', 'did', 'done', 'doing'].includes(word)) {
          const verb = annotation?.verbSpan;
          if (
            verb &&
            token.start >= verb.start &&
            token.end <= verb.end &&
            annotation?.verbHeadTokenIndex != null &&
            token.index !== annotation.verbHeadTokenIndex
          )
            continue;
          const following = tokens.slice(i + 1).filter((item) => item.kind === 'word');
          const next = following[0]?.text.toLowerCase().replace('’', "'");
          if (next === 'not' || next === "n't") continue;
          const nextVerb = following
            .find((item) => {
              const value = item.text.toLowerCase().replace('’', "'");
              return (
                value !== 'not' &&
                value !== "n't" &&
                !lexicon.intensifiers.includes(value) &&
                !lexicon.magnitudeIntensifiers.includes(value)
              );
            })
            ?.text.toLowerCase();
          if (
            nextVerb &&
            (nextVerb === 'been' ||
              /(?:ed|en|wn)$/u.test(nextVerb) ||
              lexicon.fuzzyVerbs.some((entry) => entry.split(' ')[0] === nextVerb))
          )
            continue;
        }
        const last = tokens[i + phrase.split(' ').length - 1];
        if (!last) continue;
        const verb = annotation?.verbSpan;
        issues.push(
          issue(
            'FUZZY_VERB',
            sentence.id,
            verb && token.start >= verb.start && last.end <= verb.end
              ? verb
              : { start: token.start, end: last.end },
            'verb',
          ),
        );
      }
      if (
        token.kind === 'word' &&
        word.length >= 7 &&
        !lexicon.nominalizationStop.includes(word) &&
        lexicon.nominalizationSuffixes.some((suffix) => word.endsWith(suffix)) &&
        (words[i + 1] === 'of' ||
          lexicon.fuzzyVerbs.some((phrase) => {
            const count = phrase.split(' ').length;
            return Array.from({ length: 3 }, (_, n) => i - n - count).some(
              (start) => start >= 0 && matches(start, phrase),
            );
          }))
      )
        issues.push(issue('NOMINALIZATION', sentence.id, token, 'noun'));
      if (
        !lexicon.protectedQualifiers.includes(word) &&
        tokens[i + 1]?.kind !== 'number' &&
        !/^\d/u.test(tokens[i + 1]?.text ?? '')
      ) {
        if (lexicon.intensifiers.includes(word))
          issues.push(issue('WEAK_MODIFIER', sentence.id, token, 'modifier'));
        if (lexicon.magnitudeIntensifiers.includes(word))
          issues.push(issue('UNSUPPORTED_INTENSIFIER', sentence.id, token, 'modifier'));
      }
      for (const entry of lexicon.wordyPhrases) {
        if (!matches(i, entry.phrase)) continue;
        const last = tokens[i + entry.phrase.split(' ').length - 1];
        if (!last) continue;
        const found = issue(entry.type, sentence.id, { start: token.start, end: last.end }, 'phrase');
        found.suggestedFix = entry.replacement ? `Thay bằng "${entry.replacement}"` : 'Có thể bỏ cụm này';
        issues.push(found);
      }
    }
  }
  return issues;
}
export function detectStructural(text: TextAnalysis, annotations: SentenceAnnotation[] | null): Issue[] {
  const issues: Issue[] = [];
  for (const annotation of annotations ?? []) {
    const sentence = text.sentences.find((s) => s.id === annotation.sentenceId);
    if (!sentence) continue;
    const gap = classifyGap(annotation.subjectVerbDistanceTokens);
    if ((gap === 'review' || gap === 'high') && annotation.interveningSpan) {
      const found = issue('SUBJECT_VERB_GAP', sentence.id, annotation.interveningSpan, 'intervening_phrase');
      found.severity = gap === 'high' ? 'moderate' : 'minor';
      found.confidence = annotation.parseConfidence ?? 0.5;
      found.metric = {
        name: 'subject_verb_distance_tokens',
        value: annotation.subjectVerbDistanceTokens,
        unit: 'tokens',
      };
      issues.push(found);
    }
    if (isDeepClause(annotation.maxClauseDepth)) {
      const found = issue('CLAUSE_DEPTH', sentence.id, sentence, 'sentence');
      found.metric = { name: 'max_clause_depth', value: annotation.maxClauseDepth, unit: null };
      issues.push(found);
    }
  }
  return issues;
}
export function detectCandidates(
  text: TextAnalysis,
  annotations: SentenceAnnotation[] | null,
  lexicon?: Lexicon,
): Issue[] {
  const issues = [...detectStructural(text, annotations), ...detectLexical(text, annotations, lexicon)];
  return [...new Map(issues.map((item) => [item.id, item])).values()].sort(
    (a, b) => (a.spans[0]?.start ?? 0) - (b.spans[0]?.start ?? 0) || a.type.localeCompare(b.type),
  );
}
