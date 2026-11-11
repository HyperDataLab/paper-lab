/** Bump when normalisation or the hash changes: keys from another version do not re-anchor. */
export const SENTENCE_KEY_VERSION = 'pl-skey-1' as const;

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/** Same sentence, same text: PDF extraction varies in ligatures, soft hyphens, case and spacing. */
export function normalizeSentence(text: string): string {
  return text.normalize('NFKC').replace(/­/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** 64-bit FNV-1a over UTF-8, as 16 hex digits. Synchronous so keys can be built inside a render. */
export function fnv1a64(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Gives each sentence `hash(normalised text)#n`, n counting earlier sentences with the same text. */
export function createKeyer() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const hash = fnv1a64(normalizeSentence(text));
    const ordinal = (seen.get(hash) ?? 0) + 1;
    seen.set(hash, ordinal);
    return `${hash}#${ordinal}`;
  };
}
