import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { addFields, FIELD_CATALOG, newProject } from '@/core/extraction';
import { RunPanel } from './RunPanel';

const base = newProject({
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Paper',
  researchQuestion: '',
  now: '2026-01-01T00:00:00.000Z',
});
const project = {
  ...addFields(base, FIELD_CATALOG.slice(0, 1)),
  papers: [
    {
      key: 'paper',
      source: { kind: 'paper' as const, paperId: base.id },
      title: 'Paper',
      authors: [],
      year: null,
      venue: null,
      doi: null,
      access: 'FULL_TEXT' as const,
      abstract: null,
      revision: '1',
      screening: 'included' as const,
    },
  ],
};

it('offers all catalog fields for a single paper, with estimates and optional verification', () => {
  const onStart = vi.fn();
  render(<RunPanel project={project} singlePaper onClose={vi.fn()} onStart={onStart} />);
  expect(screen.queryByText('Deep Research')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: /Full Extract/ }));
  expect(screen.getByText(`Cột (${FIELD_CATALOG.length}/${FIELD_CATALOG.length})`)).toBeInTheDocument();
  expect(screen.getByText(/50 ô · ước tính 5 lượt gọi AI/)).toBeInTheDocument();
  for (const group of new Set(FIELD_CATALOG.map((field) => field.group)))
    expect(screen.getByRole('heading', { name: group, level: 4 })).toBeInTheDocument();
  for (const field of FIELD_CATALOG)
    expect(screen.getByRole('checkbox', { name: field.label })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Kiểm chứng từng ô (High Quality)' }));
  expect(screen.getByText(/50 ô · ước tính 11 lượt gọi AI/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Chạy trích xuất (AI)' })).toBeEnabled();
  fireEvent.click(screen.getByRole('checkbox', { name: FIELD_CATALOG[0]?.label }));
  fireEvent.click(screen.getByRole('button', { name: 'Chạy trích xuất (AI)' }));
  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({
      fullExtract: true,
      mode: 'HIGH_QUALITY',
      fieldKeys: FIELD_CATALOG.slice(1).map((field) => field.key),
    }),
  );
});

it('keeps the project drawer Deep Research option', () => {
  render(
    <RunPanel
      project={{ ...project, papers: [...project.papers, { ...project.papers[0]!, key: 'second' }] }}
      onClose={vi.fn()}
      onStart={vi.fn()}
    />,
  );
  const drawer = screen.getByRole('dialog', { name: 'Chạy trích xuất' });
  expect(within(drawer).getByRole('radio', { name: /Deep Research/ })).toBeDisabled();
  expect(within(drawer).queryByText('Full Extract')).not.toBeInTheDocument();
});
