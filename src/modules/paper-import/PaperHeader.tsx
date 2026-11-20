import { ArrowLeft, Check, Cloud, CloudOff, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { paperIdentity } from '@/core/paperIdentity';
import type { Paper, PaperMetadata } from '@/core/schemas';
import type { PaperFinding } from '@/core/paperFindings';
import { ActionMenu } from '@/shared/ui/ActionBar';
import { Button } from '@/shared/ui/Button';
import { Transparency } from '@/shared/report/Transparency';
import { useProjectWorkspaceStatus } from '@/shared/storage/StorageProvider';
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
  const workspace = useProjectWorkspaceStatus();
  const [transparencyOpen, setTransparencyOpen] = useState(false);
  const bodyCount = paper.paragraphs.filter((item) => item.kind === 'body').length;
  const paperTitle = title ?? paperIdentity(paper).title;
  const syncState = workspace.status === 'error' || workspace.status === 'conflict' ? 'error' : workspace.status;
  const syncLabel =
    syncState === 'syncing'
      ? 'Đang đồng bộ'
      : syncState === 'loading'
        ? 'Đang tải project'
        : syncState === 'signed-out'
          ? 'Chưa đăng nhập'
          : syncState === 'error'
            ? 'Lỗi đồng bộ'
            : 'Đã đồng bộ';
  return (
    <>
      <header className={styles.paperHead}>
        <div className={styles.titleRow}>
          <Link to="/papers" className={styles.backLink} aria-label="Quay lại danh sách bài báo">
            <ArrowLeft size={16} aria-hidden="true" />
          </Link>
          <h1 title={paperTitle}>{paperTitle}</h1>
          <div className={styles.paperActions}>
            <span
              className={styles.syncBadge}
              data-status={syncState}
              title={`${workspace.projectName || 'ResearchHub'} · ${workspace.error || syncLabel}`}
              aria-label={`${workspace.projectName || 'ResearchHub'}: ${syncLabel}`}
            >
              {syncState === 'error' ? (
                <CloudOff size={14} aria-hidden="true" />
              ) : syncState === 'syncing' || syncState === 'loading' ? (
                <LoaderCircle size={14} aria-hidden="true" />
              ) : (
                <Cloud size={14} aria-hidden="true" />
              )}
              <span className={styles.syncProject}>{workspace.projectName || 'ResearchHub'}</span>
              <span className={styles.syncLabel}>{syncLabel}</span>
              {syncState === 'synced' && <Check size={13} aria-hidden="true" />}
            </span>
            <ActionMenu
              label="Thao tác bài báo"
              icon
              items={[
                { label: 'Minh bạch', onSelect: () => setTransparencyOpen(true) },
                { label: 'Thông tin xuất bản', onSelect: onInfo },
              ]}
            />
            <Transparency
              paper={paper}
              open={transparencyOpen}
              onOpenChange={setTransparencyOpen}
              hideTrigger
              parserCounts={`${paper.source.pageCount ?? 'Không rõ'} trang · ${paper.sections.length} mục · ${bodyCount} đoạn nội dung${counts ? ` · ${counts.sentences} câu · ${counts.words} từ` : ''}`}
            />
          </div>
        </div>
        <p className={styles.paperMeta} title={
          [metadata?.authors.join(', '), metadata?.venue, metadata?.year, metadata?.doi].filter(Boolean).join(' · ')
        }>
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
