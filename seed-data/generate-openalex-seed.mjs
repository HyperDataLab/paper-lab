import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outputPath = fileURLToPath(new URL('./ai-higher-education-openalex.json', import.meta.url));
const api = 'https://api.openalex.org/works';
const targetCount = 10;
const pageSize = 100;
const selectedFields = [
  'id',
  'doi',
  'display_name',
  'publication_year',
  'authorships',
  'primary_location',
  'best_oa_location',
  'open_access',
  'primary_topic',
  'keywords',
  'type',
];
const params = new URLSearchParams({
  search: 'artificial intelligence higher education',
  filter: 'is_oa:true',
  'per-page': String(pageSize),
  select: selectedFields.join(','),
  cursor: '*',
});
const startedAt = new Date().toISOString();
const requestUrls = [];
const works = [];
let totalReported = 0;
let retrieved = 0;

const url = `${api}?${params}`;
requestUrls.push(url);
const response = await fetch(url, { headers: { 'User-Agent': 'PaperLab-seed-data/1.0' } });
if (!response.ok) {
  const details = await response.text();
  throw new Error(`OpenAlex responded ${response.status} ${response.statusText}: ${details}`);
}

const page = await response.json();
totalReported = page.meta?.count ?? totalReported;
const results = Array.isArray(page.results) ? page.results : [];
retrieved = results.length;

async function verifyPdf(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-1023' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }

    const reader = response.body?.getReader();
    if (!reader) return response.headers.get('content-type')?.toLowerCase().includes('pdf') ?? false;
    const chunks = [];
    let size = 0;
    while (size < 1024) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    await reader.cancel();
    const prefix = new Uint8Array(Math.min(size, 1024));
    let offset = 0;
    for (const chunk of chunks) {
      const length = Math.min(chunk.length, prefix.length - offset);
      prefix.set(chunk.subarray(0, length), offset);
      offset += length;
      if (offset >= prefix.length) break;
    }
    return new TextDecoder('ascii').decode(prefix).includes('%PDF-');
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const candidates = results.filter((work) =>
  work.doi && work.display_name && Number.isInteger(work.publication_year) && work.best_oa_location?.pdf_url,
);
for (let index = 0; index < candidates.length && works.length < targetCount; index += 6) {
  const batch = candidates.slice(index, index + 6);
  const verified = await Promise.all(batch.map(async (work) => ({
    work,
    location: work.best_oa_location,
    downloadable: await verifyPdf(work.best_oa_location.pdf_url),
  })));
  for (const item of verified) {
    if (!item.downloadable) continue;
    works.push({ work: item.work, location: item.location });
    if (works.length >= targetCount) break;
  }
}

if (works.length < targetCount) {
  throw new Error(`Only ${works.length} downloadable OA PDFs verified; expected ${targetCount}.`);
}

const exportedAt = new Date().toISOString();
const corpusId = randomUUID();
const library = [];
const members = [];
const seenDois = new Set();

for (const { work, location } of works) {
  const doi = work.doi.replace(/^https?:\/\/doi\.org\//iu, '');
  const normalizedDoi = doi.toLowerCase();
  if (seenDois.has(normalizedDoi)) continue;
  seenDois.add(normalizedDoi);

  const libraryId = randomUUID();
  const memberId = randomUUID();
  const authors = (work.authorships ?? [])
    .map((authorship) => authorship.author?.display_name)
    .filter((name) => typeof name === 'string' && name.length > 0);
  const source = work.primary_location?.source;
  const topic = work.primary_topic;
  const taxonomy = topic
    ? {
        domain: topic.domain?.display_name ?? null,
        field: topic.field?.display_name ?? null,
        subfield: topic.subfield?.display_name ?? null,
        topic: topic.display_name ?? null,
        score: topic.score ?? null,
        domainId: topic.domain?.id?.replace('https://openalex.org/', '') ?? null,
        fieldId: topic.field?.id?.replace('https://openalex.org/', '') ?? null,
        subfieldId: topic.subfield?.id?.replace('https://openalex.org/', '') ?? null,
      }
    : null;
  const keywords = (work.keywords ?? [])
    .filter((keyword) => typeof keyword.id === 'string' && typeof keyword.display_name === 'string')
    .slice(0, 20)
    .map((keyword) => ({
      id: keyword.id.replace('https://openalex.org/', ''),
      name: keyword.display_name,
      score: keyword.score ?? 0,
    }))
    .filter((keyword) => /^keywords\/[a-z0-9][a-z0-9-]*$/u.test(keyword.id));

  library.push({
    schemaVersion: 1,
    id: libraryId,
    doi,
    addedAt: exportedAt,
    updatedAt: exportedAt,
    lookup: 'done',
    title: work.display_name,
    authors,
    year: work.publication_year,
    venue: source?.display_name ?? null,
    access: 'open',
    oa_sources: [
      {
        source: 'openalex',
        landing_url: location.landing_page_url ?? null,
        pdf_url: location.pdf_url,
        license: location.license ?? null,
        version: location.version ?? null,
      },
    ],
    arxiv_id: null,
    taxonomy,
    openalex_id: work.id ?? null,
    keywords,
    paper_id: null,
    file_matches_title: null,
    error: null,
  });

  members.push({
    memberId,
    title: work.display_name,
    identifiers: {
      doi,
      openalexId: work.id,
      sha256: [],
      paperIds: [],
      libraryIds: [libraryId],
    },
    exportId: `seed-${memberId}`,
    role: null,
    stratum: { year: work.publication_year, articleType: work.type ?? 'article' },
    version: location.version ?? null,
    retrieval: 'sought',
    textRead: 'METADATA_ONLY',
    authorIds: (work.authorships ?? [])
      .map((authorship) => authorship.author?.id)
      .filter((id) => typeof id === 'string'),
    countries: [],
    decisions: [],
    appraisal: [],
    inputs: null,
  });
}

const seed = {
  format: 'paragraph-lab-export',
  formatVersion: 1,
  exportedAt,
  appVersion: '0.1.0',
  analyses: [],
  auditEvents: [],
  revisions: [],
  generations: [],
  papers: [],
  paperOverviews: [],
  paperChecks: [],
  paperReviews: [],
  paperProbes: [],
  calibrationLabels: [],
  measurements: [],
  library,
  stance: [],
  paperInsights: [],
  extractionProjects: [],
  researchDesigns: [],
  researchDesignBanks: [],
  corpora: [
    {
      format: 'paperlab-corpus',
      schemaVersion: 1,
      id: corpusId,
      kind: 'topic',
      title: 'AI in Higher Education — OpenAlex OA papers with PDF links',
      createdAt: exportedAt,
      updatedAt: exportedAt,
      protocol: [
        {
          version: 1,
          createdAt: exportedAt,
          body: {
            researchQuestion: 'How is artificial intelligence being adopted and evaluated in higher education?',
            inclusion: [
              'Scholarly work about artificial intelligence or generative AI in higher education',
              'Work with a DOI and an OpenAlex-indexed Open Access PDF URL verified as a downloadable PDF',
            ],
            exclusion: ['Work unrelated to post-secondary education'],
            years: [...new Set(library.map((item) => item.year))].sort((a, b) => a - b),
          },
        },
      ],
      searches: [
        {
          source: 'openalex',
          requestUrl: requestUrls[0],
          requestUrls,
          params: {
            search: 'artificial intelligence higher education',
            filter: 'is_oa:true',
            'per-page': String(pageSize),
            select: selectedFields.join(','),
          },
          runAt: startedAt,
          totalReported,
          retrieved,
          duplicates: works.length - members.length,
          added: members.length,
          truncated: true,
          updateRound: 0,
          memberIds: members.map((member) => member.memberId),
        },
      ],
      members,
      runs: [],
      releases: [],
      aliases: [],
    },
  ],
  corpusProfiles: [],
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputPath: resolve(outputPath), library: library.length, corpusMembers: members.length, downloadablePdfsVerified: works.length, requests: requestUrls.length, totalReported }));
