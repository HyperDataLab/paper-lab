import { citationMentions, paperReferenceParagraphs, referenceEntries } from '../paperChecks/references';
import type { Paper, PaperModel, PaperModelSentence } from '../schemas';

/** Only link a mention when the key identifies one bibliography entry and the model kept its text. */
export function citationEvidence(paper: Paper, model: PaperModel) {
  const references = new Map(model.document.references.map((ref) => [ref.text, ref.id]));
  const bibliography = paperReferenceParagraphs(paper);
  const entries = referenceEntries(bibliography);
  const targets = new Map<string, string | null>();
  for (const entry of entries) {
    for (const key of new Set(entry.keys)) {
      targets.set(key, targets.has(key) ? null : (references.get(entry.text) ?? null));
    }
  }
  const keysByReference = new Map<string, Set<string>>();
  if (![...targets.values()].some(Boolean)) return keysByReference;
  const byParagraph = new Map<string, PaperModelSentence[]>();
  for (const sentence of model.sentences) {
    const group = byParagraph.get(sentence.paragraphId);
    if (group) group.push(sentence);
    else byParagraph.set(sentence.paragraphId, [sentence]);
  }
  const body = paper.paragraphs.filter((p) => p.kind === 'body' && byParagraph.has(p.id));
  for (const { key, loc } of citationMentions(body).cited) {
    const reference = targets.get(key);
    if (!reference) continue;
    const sentence = byParagraph.get(loc.paragraph.id)?.find((s) => s.start <= loc.start && s.end >= loc.end);
    if (!sentence) continue;
    const keys = keysByReference.get(reference) ?? new Set<string>();
    keys.add(sentence.key);
    keysByReference.set(reference, keys);
  }
  return keysByReference;
}
