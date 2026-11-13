import { ArrowLeft, Info, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { paperIdentity } from '@/core/paperIdentity';
import type { Paper, PaperMetadata } from '@/core/schemas';
import type { PaperFinding } from '@/core/paperFindings';
import { Transparency } from '@/shared/report/Transparency';
import { Button } from '@/shared/ui/Button';
import { IconButton } from '@/shared/ui/IconButton';
import { Tabs } from '@/shared/ui/Tabs';
import { SPACES } from './paperPlaces';
import type { PaperNavigation } from './usePaperNavigation';
import styles from './page.module.css';

/** The paper's title and publication line, and the switch between the paper and the spaces behind it. */
export function PaperHeader({
  nav,
  paper,
  title,
  metadata,
  counts,
  findings,
  onInfo,
}: {
  nav: PaperNavigation;
  paper: Paper;
  /** The title as the publication records give it, once known. */
  title: string | null;
  metadata: Pick<PaperMetadata, 'authors' | 'venue' | 'year' | 'doi'> | null;
  counts: { sentences: number; words: number } | null;
  findings: PaperFinding[];
  onInfo: () => void;
}) {
  const { wide, splitWanted } = nav;
  const bodyCount = paper.paragraphs.filter((item) => item.kind === 'body').length;
  return (
    <>
      <header className={styles.paperHead}>
        <Link to="/papers" className={styles.backLink}>
          <ArrowLeft size={14} aria-hidden="true" />
          Bài báo đã nhập
        </Link>
        <div className={styles.titleRow}>
          <h1>{title ?? paperIdentity(paper).title}</h1>
          <div className={styles.row}>
            {wide && (
              <IconButton
                aria-pressed={!splitWanted}
                label={splitWanted ? 'Ẩn phân tích' : 'Hiện phân tích'}
                onClick={nav.toggleSplit}
              >
                {splitWanted ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </IconButton>
            )}
            <Transparency
              paper={paper}
              parserCounts={`${paper.source.pageCount ?? 'Không rõ'} trang · ${paper.sections.length} mục · ${bodyCount} đoạn nội dung${counts ? ` · ${counts.sentences} câu · ${counts.words} từ` : ''}`}
            />
            <Button aria-label="Thông tin xuất bản" variant="ghost" onClick={onInfo}>
              <Info size={18} aria-hidden="true" />
              <span className={styles.headerLabel}>Thông tin xuất bản</span>
            </Button>
          </div>
        </div>
        <p className={styles.paperMeta}>
          {[
            metadata?.authors[0] && `${metadata.authors[0]}${metadata.authors.length > 1 ? ' et al.' : ''}`,
            metadata?.venue,
            metadata?.year,
          ]
            .filter(Boolean)
            .join(' · ')}
          {metadata?.doi && (
            <>
              {' '}
              ·{' '}
              <a href={`https://doi.org/${metadata.doi}`} target="_blank" rel="noreferrer">
                DOI↗
              </a>
            </>
          )}
        </p>
      </header>
      <div className={styles.spaceTabs}>
        <Tabs label="Spaces">
          <Button role="tab" aria-selected={!nav.inSpace} onClick={() => nav.setTab('map')}>
            Bài báo
          </Button>
          {SPACES.map((item) => {
            const count = findings.filter((finding) =>
              item.id === 'arguments'
                ? finding.criterion === 'claim' || finding.criterion === 'evidence'
                : item.id === 'writing' && finding.criterion === 'writing',
            ).length;
            return (
              <Button
                key={item.id}
                role="tab"
                aria-selected={nav.mode === item.id}
                onClick={() => nav.openSpace(item.id)}
              >
                {item.label}
                {count > 0 && (
                  <span className={styles.spaceCount} aria-label={`${count} issues`}>
                    {count}
                  </span>
                )}
              </Button>
            );
          })}
        </Tabs>
      </div>
    </>
  );
}
