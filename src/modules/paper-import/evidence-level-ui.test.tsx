import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { EvidenceLevelBadge } from './EvidenceLevel';

it('P7 shows the evidence level with its basis in the title', () => {
  render(<EvidenceLevelBadge level="E3" basis="Có khoảng tin cậy qua 5 lần chạy." />);
  const badge = screen.getByText('Mức bằng chứng E3');
  const title = badge.closest('[title]')?.getAttribute('title') ?? '';
  expect(title).toContain('AI gán');
  expect(title).toContain('Căn cứ: Có khoảng tin cậy qua 5 lần chạy.');
});

it('P7 shows nothing when the argument has no level', () => {
  const { container } = render(
    <>
      <EvidenceLevelBadge level={null} basis={null} />
      <EvidenceLevelBadge />
    </>,
  );
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByText(/Mức bằng chứng/)).toBeNull();
});
