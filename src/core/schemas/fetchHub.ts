import { z } from 'zod';

const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const sizeBytes = z.number().int().positive();
const status = z.enum([
  'held',
  'queued',
  'claimed',
  'fetching_public',
  'fetching_institutional',
  'uploading',
  'needs_human',
  'done',
  'failed',
  'cancelled',
]);
export const HubRequestsResponse = z.object({
  results: z.array(
    z.discriminatedUnion('outcome', [
      z.object({ doi: z.string(), outcome: z.enum(['created', 'joined']), doiKey: digest, status }),
      z.object({
        doi: z.string(),
        outcome: z.literal('invalid'),
        doiKey: digest.nullish(),
        status: status.nullish().or(z.literal('unknown')),
      }),
    ]),
  ),
});

export const HubStatusResponse = z.object({
  papers: z.array(
    z.object({
      doiKey: digest,
      status: status.or(z.literal('unknown')),
      needsHumanReason: z.string().optional(),
      failureCode: z.string().optional(),
      message: z.string().optional(),
      source: z.string().optional(),
      sha256: digest.optional(),
      sizeBytes: sizeBytes.optional(),
      updatedAt: z.iso.datetime({ offset: true }).nullish(),
    }),
  ),
});
export type HubPaperStatus = z.output<typeof HubStatusResponse>['papers'][number];

export const HubPdfResponse = z
  .object({ r2Key: z.string(), sha256: digest, sizeBytes })
  .refine(({ r2Key, sha256 }) => r2Key === `paperlab/pdfs/${sha256}.pdf`, { path: ['r2Key'] });

export const HubErrorResponse = z.object({ error: z.string() });
