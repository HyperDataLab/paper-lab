import { sourceHash } from '../text/hash';

/** Match Paper Fetch Hub's worker/src/doi.ts so both apps look up the same paper. */
export async function doiKey(raw: string): Promise<string | null> {
  const doi = raw
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/iu, '')
    .trim()
    .toLowerCase()
    .replace(/[.,;:\s]+$/u, '');
  if (!/^10\.\d{4,9}\/\S+$/u.test(doi)) return null;
  return (await sourceHash(doi)).slice('sha256:'.length);
}
