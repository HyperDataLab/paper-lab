import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { addFields, customField, FIELD_CATALOG, newProject } from '@/core/extraction';
import { useExtractionRun } from './useExtractionRun';

const mocks = vi.hoisted(() => ({ extract: vi.fn(), save: vi.fn(), flush: vi.fn() }));
vi.mock('@/shared/llm/LlmProvider', () => ({
  useLlm: () => ({ ensureConsent: async () => true, client: {}, config: {} }),
}));
vi.mock('@/shared/storage/StorageProvider', () => ({
  useRepositories: () => ({
    extraction: { recordEvents: vi.fn(), checkpoint: mocks.save, flush: mocks.flush },
  }),
}));
vi.mock('@/shared/llm/llmExtraction', () => ({ llmExtraction: mocks.extract }));

it('adds missing catalog columns before running while preserving existing columns and selected fields', async () => {
  const base = newProject({
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Paper',
    researchQuestion: '',
    now: '2026-01-01T00:00:00.000Z',
  });
  const custom = customField({ label: 'Own field', description: '', instruction: '', existing: [] });
  const project = addFields(base, [custom, ...FIELD_CATALOG.slice(0, 1)]);
  mocks.extract.mockImplementation(async (_client, prepared) => prepared);
  mocks.save.mockImplementation(async (value) => value);
  const { result } = renderHook(() => useExtractionRun(project, new Map(), vi.fn(), vi.fn()));
  const fieldKeys = FIELD_CATALOG.slice(1).map((field) => field.key);
  await act(async () =>
    result.current.run({
      fullExtract: true,
      mode: 'STANDARD',
      paperKeys: [],
      fieldKeys,
      keepVerified: true,
      budget: 10,
    }),
  );
  const prepared = mocks.extract.mock.calls[0]?.[1];
  expect(prepared.fields.map((field: { key: string }) => field.key)).toEqual([
    custom.key,
    ...FIELD_CATALOG.map((field) => field.key),
  ]);
  expect(mocks.extract.mock.calls[0]?.[3]).toEqual(expect.objectContaining({ fieldKeys, mode: 'STANDARD' }));
  expect(mocks.flush).toHaveBeenCalledWith(project.id);
});
