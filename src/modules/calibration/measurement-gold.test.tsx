import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fixturePaper, fixtureRun, PAPER_ID } from '@/core/measurement/testFixture';
import { createDb } from '@/shared/storage/db';
import { createRepositories } from '@/shared/storage/repositories';
import { StorageProvider } from '@/shared/storage/StorageProvider';
import { MeasurementGoldCard } from './MeasurementGold';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
async function setup() {
  const repo = createRepositories(createDb(`gold-${crypto.randomUUID()}`));
  await repo.papers.create(fixturePaper);
  await repo.measurements.saveRun(PAPER_ID, fixtureRun());
  render(
    <StorageProvider repositories={repo}>
      <MeasurementGoldCard />
    </StorageProvider>,
  );
}
const file = (name: string, value: unknown) =>
  new File([typeof value === 'string' ? value : JSON.stringify(value)], name, { type: 'application/json' });
const gold = (sha: string) => ({
  format: 'paragraph-lab-measurement-gold',
  version: 1,
  paper_sha256: sha,
  rater: 'a',
  metrics: [{ name: 'Accuracy' }],
  results: [{ value: '0.123', unit: '%', blockId: 't1', reader_correct: true }],
  reported_protocol_fields: [],
});
const upload = (files: File[]) =>
  fireEvent.change(screen.getByLabelText('Tệp nhãn chuẩn'), { target: { files } });

it('§12 stays not measured until labels exist', async () => {
  await setup();
  expect(screen.getAllByText('Chưa đo')).toHaveLength(6);
  expect(screen.getByText('Đã đo trên 0/30 bài')).toBeInTheDocument();
});

it('§12 scores matching papers and reports the rest', async () => {
  await setup();
  upload([file('ok.json', gold('sha256:abc')), file('other.json', gold('sha256:zzz'))]);
  expect(await screen.findByText(/Đã đo trên 1\/30 bài/)).toBeInTheDocument();
  expect(screen.getByText('Chưa có hồ sơ cho: other.json.')).toBeInTheDocument();
  expect(screen.getAllByText('Đạt mục tiêu')).toHaveLength(4);
});

it('§12 rejects a malformed file', async () => {
  await setup();
  upload([file('bad.json', 'not json')]);
  expect(await screen.findByRole('alert')).toHaveTextContent('Tệp không đúng định dạng');
});
