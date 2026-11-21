import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { emptyResearchDesign } from '@/core/schemas/researchDesign';
import { acceptConsent, getConfig, InvalidModelOutputError, type LlmClient } from '@/shared/llm';
import { LlmProvider } from '@/shared/llm/LlmProvider';
import { ToastProvider } from '@/shared/ui/ToastProvider';
import EvidenceSection from '../sections/EvidenceSection';
import QuestionsSection from '../sections/QuestionsSection';
import MeasurementSection from '../sections/MeasurementSection';
import DesignSection from '../sections/DesignSection';
import AnalysesSection from '../sections/AnalysesSection';
import { facts, harness, model, paper, projectId } from './testSupport';

vi.mock('../ResearchDesignProvider', async () => ({
  useResearchDesign: (await import('./testSupport')).useTestDesign,
}));

const ref = 'project-paper-1/fact-1';
beforeEach(() => localStorage.clear());

function setup(options: { used?: boolean; consent?: boolean; section?: typeof EvidenceSection } = {}) {
  if (options.consent !== false) acceptConsent(getConfig());
  const design = emptyResearchDesign(projectId);
  if (options.used)
    design.facts['project-paper-1'] = {
      schemaVersion: 1,
      paperId: 'project-paper-1',
      source: {
        paperlabId: facts.paperId,
        etag: facts.modelEtag,
        fetchedBy: 'local',
        fetchedAt: facts.generatedAt,
      },
      facts,
      decisions: { 'fact-1': { decision: 'use', reason: null, by: 'local', at: '2026-01-01T00:00:00.000Z' } },
      matches: {},
    };
  const completeJson = vi.fn<(options: Parameters<LlmClient['completeJson']>[0]) => Promise<unknown>>();
  completeJson.mockResolvedValue({
    data: { suggestions: [{ text: 'Measure invented accuracy', cites: [ref, 'project-paper-9/unknown'] }] },
    meta: { model: 'invented', promptVersion: 'plan-suggestion-1', latencyMs: 1, repaired: false },
  });
  const client = { completeJson } as unknown as LlmClient;
  const context = harness({
    papers: [paper(1)],
    live: { 'project-paper-1': { facts, model } },
    design,
  });
  const Section = options.section ?? EvidenceSection;
  render(
    <MemoryRouter>
      <LlmProvider innerClient={client}>
        <ToastProvider>
          <context.Harness>
            <Section />
          </context.Harness>
        </ToastProvider>
      </LlmProvider>
    </MemoryRouter>,
  );
  return { ...context, completeJson };
}

for (const [Section, label, target] of [
  [QuestionsSection, 'Hypothesis', 'hypotheses'],
  [MeasurementSection, 'Metric', 'metrics'],
  [DesignSection, 'Nguy cơ', 'threats'],
  [AnalysesSection, 'Phân tích', 'analyses'],
] as const) {
  it(`FR-405 scopes ${target} suggestions and saves only on acceptance`, async () => {
    const ctx = setup({ used: true, section: Section });
    await open();
    expect(screen.getByRole('radio', { name: label })).toBeChecked();
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    await send();
    const add = await screen.findByRole('button', { name: 'Thêm vào bản nháp' });
    expect(ctx.save).not.toHaveBeenCalled();
    fireEvent.click(add);
    await waitFor(() => expect(ctx.saved).toHaveLength(1));
    const items = ctx.saved[0]!.draft[target];
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items[0])).toContain('Measure invented accuracy');
  });
}

it('FR-405 disables section suggestions without selected facts or consent', () => {
  const ctx = setup({ section: DesignSection });
  expect(screen.getByRole('button', { name: 'Gợi ý từ bảng so sánh' })).toBeDisabled();
  expect(screen.getByText(/Chọn dữ kiện Dùng/)).toBeInTheDocument();
  expect(ctx.completeJson).not.toHaveBeenCalled();
});

it('FR-405 disables section suggestions without consent', () => {
  setup({ used: true, consent: false, section: DesignSection });
  expect(screen.getByRole('button', { name: 'Gợi ý từ bảng so sánh' })).toBeDisabled();
  expect(screen.getByText(/Kiểm tra kết nối trong Cài đặt/)).toBeInTheDocument();
});
async function open() {
  fireEvent.click(await screen.findByRole('button', { name: 'Gợi ý từ bảng so sánh' }));
}
async function send() {
  fireEvent.click(await screen.findByRole('button', { name: 'Gửi và nhận gợi ý' }));
}

it('FR-405 does not send without a use decision', async () => {
  const ctx = setup();
  await open();
  expect(await screen.findByText('Chưa có dữ kiện nào được đặt Dùng.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Gửi và nhận gợi ý' })).not.toBeInTheDocument();
  expect(ctx.completeJson).not.toHaveBeenCalled();
});

it('FR-405 sends one minimal request with its prompt version and estimate, and removes unknown citations', async () => {
  const ctx = setup({ used: true });
  await open();
  expect(await screen.findByText(/Sẽ gửi 1 dữ kiện/)).toBeInTheDocument();
  expect(screen.getByText('Ước tính 1 lượt gọi AI')).toBeInTheDocument();
  await send();
  expect(await screen.findByText('Đã bỏ 1 trích dẫn không thuộc dữ kiện đã gửi.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Accuracy · Paper 1' })).toBeInTheDocument();
  expect(screen.queryByText(/unknown/)).not.toBeInTheDocument();
  expect(ctx.completeJson).toHaveBeenCalledTimes(1);
  const options = ctx.completeJson.mock.calls[0]![0];
  expect(options.promptVersion).toBe('plan-suggestion-2');
  const body = `${options.system}\n${options.user}`;
  expect(body).toContain('Accuracy');
  expect(body).not.toContain('f070f37a466398fb#1');
  expect(body).not.toContain(model.sentences[0]!.text);
  expect(body).not.toContain('Invented table text');
  expect(ctx.save).not.toHaveBeenCalled();
});

it('FR-405 reports unreadable answers', async () => {
  const ctx = setup({ used: true });
  ctx.completeJson.mockRejectedValue(new InvalidModelOutputError('bad', 'bad'));
  await open();
  await send();
  expect(await screen.findByText('AI trả lời không đúng định dạng; hãy thử lại.')).toBeInTheDocument();
});

it('FR-405 asks for consent and does not call AI when it is declined', async () => {
  const ctx = setup({ used: true, consent: false });
  await open();
  await send();
  fireEvent.click(await screen.findByRole('button', { name: 'Huỷ' }));
  expect(await screen.findByText(/Cần đồng ý gửi dữ liệu cho AI/)).toBeInTheDocument();
  expect(ctx.completeJson).not.toHaveBeenCalled();
});

for (const [target, label] of [
  ['hypotheses', 'Hypothesis'],
  ['metrics', 'Metric'],
  ['threats', 'Nguy cơ'],
] as const) {
  it(`FR-405 adds ${target} through the draft operation only when a person presses it`, async () => {
    const ctx = setup({ used: true });
    await open();
    fireEvent.click(await screen.findByRole('radio', { name: label }));
    await send();
    const add = await screen.findByRole('button', { name: 'Thêm vào bản nháp' });
    expect(ctx.save).not.toHaveBeenCalled();
    fireEvent.click(add);
    expect(await screen.findByText('Đã thêm')).toBeInTheDocument();
    await waitFor(() => expect(ctx.saved).toHaveLength(1));
    const draft = ctx.saved[0]!.draft;
    if (target === 'hypotheses')
      expect(draft.hypotheses[0]).toMatchObject({
        statement: 'Measure invented accuracy',
        kind: 'exploratory',
        claim: null,
        question: null,
      });
    if (target === 'metrics')
      expect(draft.metrics[0]).toMatchObject({
        name: 'Measure invented accuracy',
        key: 'measure_invented_accuracy',
        protocol: 'Measure invented accuracy',
        bank: null,
      });
    if (target === 'threats')
      expect(draft.threats[0]).toMatchObject({
        name: 'Measure invented accuracy',
        mitigation: '',
        bank: null,
      });
  });
}
