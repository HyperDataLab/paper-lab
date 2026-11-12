import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { exampleInsights, examplePaper, exampleStance } from '@/core/paperModel/contract';
import { LabelCoverage } from './LabelCoverage';
import { LABEL_VERSIONS } from './labelPlan';
import { exclusionLabel, memberRoleLabel, versionLabel } from './labels';

it('shows section roles as on the paper page in coverage', () => {
  const paper = examplePaper();
  const insights = exampleInsights(paper);
  const run = insights.rhetoricRuns[0];
  if (!run) throw new Error('missing run');
  run.promptVersion = LABEL_VERSIONS.rhetoric;
  render(<LabelCoverage items={[{ memberId: 'one', paper, insights, stance: exampleStance(paper) }]} />);
  expect(screen.getByRole('cell', { name: 'Results' })).toBeInTheDocument();
});

it('renders sampling exclusions in Vietnamese', () => {
  const { rerender } = render(<p>{exclusionLabel({ retracted: 2, title: 1, missing_doi: 3 })}</p>);
  expect(screen.getByText('Đã loại: 2 bài bị rút, 1 xã luận/đính chính, 3 thiếu DOI')).toBeInTheDocument();
  rerender(<p>{exclusionLabel({})}</p>);
  expect(screen.getByText('Đã loại: không có')).toBeInTheDocument();
});

it('renders all member roles and versions including missing values', () => {
  render(
    <div>
      {(['build', 'held_out', null] as const).map((role) => (
        <span key={role ?? 'none'}>{memberRoleLabel(role)}</span>
      ))}
      {(['publishedVersion', 'acceptedVersion', 'submittedVersion', null] as const).map((version) => (
        <span key={version ?? 'none'}>{versionLabel(version)}</span>
      ))}
    </div>,
  );
  for (const label of ['Xây dựng', 'Giữ riêng kiểm tra', 'Bản chính thức', 'Bản chấp nhận', 'Bản nộp'])
    expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getAllByText('—')).toHaveLength(2);
});
