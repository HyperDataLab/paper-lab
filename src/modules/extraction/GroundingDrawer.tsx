import { Link } from 'react-router-dom';
import { paperEvidence } from '@/core/extraction';
import type { ExtractionProject, GroundedCitation, ProjectPaper, Synthesis } from '@/core/schemas';
import { Badge } from '@/shared/ui/Badge';
import { Drawer } from '@/shared/ui/Drawer';
import { SheetSection } from '@/shared/ui/SheetSection';
import styles from './sheets.module.css';

export type GroundingTarget =
  { kind: 'citation'; citation: GroundedCitation; claim: string } | { kind: 'paper'; paperKey: string };

/** A link to the exact passage in a paper stored here, so the quote can be read in context. */
function passageLink(paper: ProjectPaper | undefined, quote: GroundedCitation['quotes'][number]) {
  if (paper?.source.kind !== 'paper' || !quote.paragraphId) return null;
  const query = new URLSearchParams({ p: quote.paragraphId, s: String(quote.start), e: String(quote.end) });
  return `/papers/${paper.source.paperId}?${query.toString()}`;
}

function Quotes({ citation, paper }: { citation: GroundedCitation; paper: ProjectPaper | undefined }) {
  if (!citation.quotes.length)
    return <p className={styles.missing}>Không có đoạn trích tìm thấy trong bài cho giá trị này.</p>;
  return (
    <ul className={styles.quotes}>
      {citation.quotes.map((quote) => {
        const link = passageLink(paper, quote);
        return (
          <li key={`${quote.paragraphId}:${quote.start}`}>
            <blockquote>{quote.quote}</blockquote>
            <span className={styles.where}>
              {[quote.page ? `Tr. ${quote.page}` : null, quote.section].filter(Boolean).join(' · ') ||
                'Tóm tắt'}
              {link && (
                <>
                  {' · '}
                  <Link to={link}>Xem đoạn này trong bài</Link>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Signals({ citation }: { citation: GroundedCitation }) {
  return (
    <div className={styles.badges}>
      <Badge tone={citation.fullText ? 'success' : 'neutral'}>
        {citation.fullText ? 'Đã dùng toàn văn' : 'Chỉ dùng tóm tắt'}
      </Badge>
      {citation.humanVerified && <Badge tone="accent">Người đã xác nhận giá trị</Badge>}
    </div>
  );
}

export function GroundingDrawer({
  project,
  synthesis,
  target,
  onClose,
}: {
  project: ExtractionProject;
  synthesis: Synthesis;
  target: GroundingTarget;
  onClose: () => void;
}) {
  const paperKey = target.kind === 'citation' ? target.citation.paperKey : target.paperKey;
  const paper = project.papers.find((item) => item.key === paperKey);
  const label = target.kind === 'citation' ? 'Trích dẫn nguồn' : 'Bằng chứng từ bài này';
  const evidence = target.kind === 'paper' ? paperEvidence(synthesis, paperKey) : [];
  return (
    <Drawer
      open
      onClose={onClose}
      label={label}
      side="right"
      title={label}
      description={[paper?.title ?? paperKey, paper?.year].filter(Boolean).join(' · ')}
      footer={
        paper?.source.kind !== 'paper' && paper?.doi ? (
          <a className={styles.link} href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer">
            Mở bài gốc theo DOI
          </a>
        ) : undefined
      }
    >
      {target.kind === 'citation' ? (
        <>
          <Signals citation={target.citation} />
          <SheetSection title="Nhận định">
            <p className={styles.value}>{target.claim}</p>
          </SheetSection>
          <SheetSection title={`Dựa trên giá trị · ${target.citation.fieldLabel}`}>
            <p className={styles.value}>{target.citation.value}</p>
          </SheetSection>
          <SheetSection title="Đoạn trích trong bài">
            <Quotes citation={target.citation} paper={paper} />
          </SheetSection>
        </>
      ) : evidence.length === 0 ? (
        <p className={styles.missing}>Bản tổng hợp không dùng đoạn trích nào từ bài này.</p>
      ) : (
        evidence.map(({ citation, claims }) => (
          <SheetSection key={citation.fieldKey} title={citation.fieldLabel}>
            <Signals citation={citation} />
            <p className={styles.value}>{citation.value}</p>
            <Quotes citation={citation} paper={paper} />
            <span className={styles.hint}>Dùng cho {claims.length} nhận định:</span>
            <ul className={styles.flags}>
              {claims.map((claim) => (
                <li key={claim}>{claim}</li>
              ))}
            </ul>
          </SheetSection>
        ))
      )}
      <p className={styles.hint}>
        Đoạn trích là nguyên văn mà chương trình tìm thấy trong bài cho giá trị này, lưu lại lúc tổng hợp. Hãy
        đọc đoạn trích để tự xét nhận định có đúng với bài hay không.
      </p>
    </Drawer>
  );
}
