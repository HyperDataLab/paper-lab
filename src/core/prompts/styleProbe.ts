import { z } from 'zod';

export const STYLE_PROBE_SYSTEM = `Rewrite the paragraph changing only surface style: word order, sentence boundaries, connectives and word choice.
Keep every claim, number, unit, citation, hedge, negation and technical term exactly. Do not add or remove
information, do not make claims more confident, do not add sections, results or answers.
Return the rewritten paragraph only.`;

export const StyleProbeOutputSchema = z.object({ rewritten: z.string() });

export function buildStyleProbePrompt(text: string) {
  return { system: STYLE_PROBE_SYSTEM, user: text };
}
