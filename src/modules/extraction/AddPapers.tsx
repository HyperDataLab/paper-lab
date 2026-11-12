import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { projectPaperFromLibrary, projectPaperFromPaper } from '@/core/extraction';
import type { ExtractionProject, LibraryItem, Paper, PaperMetadata, ProjectPaper } from '@/core/schemas';
import { createScholarClient } from '@/shared/scholar/client';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Checkbox } from '@/shared/ui/Checkbox';
import { Drawer } from '@/shared/ui/Drawer';
import styles from './extraction.module.css';

/** Imported papers are read in full. Library DOIs without a file are read from their OpenAlex abstract. */
export function AddPapers({
  project,
  onClose,
  onAdd,
}: {
  project: ExtractionProject;
  onClose: () => void;
  onAdd: (papers: ProjectPaper[]) => void;
}) {
  const repo = useRepositories();
  const [papers, setPapers] = useState<Paper[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [metadata, setMetadata] = useState(new Map<string, PaperMetadata | null>());
  const [chosen, setChosen] = useState<string[]>([]);
  const [missingAbstractIds, setMissingAbstractIds] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    void Promise.all([repo.papers.list(), repo.library.list(), repo.paperContext.list()]).then(
      ([savedPapers, items, contexts]) => {
        setPapers(savedPapers);
        setLibrary(items);
        setMetadata(new Map(contexts.map((item) => [item.paperId, item.metadata])));
      },
    );
  }, [repo]);
  const paperInProject = (key: string) => project.papers.find((paper) => paper.key === key);
  const inProject = (key: string) => Boolean(paperInProject(key));
  const retryCount = chosen.filter((key) => paperInProject(key)?.access === 'METADATA_ONLY').length;
  const toggle = (key: string, on: boolean) =>
    setChosen((old) => (on ? [...old, key] : old.filter((item) => item !== key)));
  const linked = (paper: Paper) => library.find((item) => item.paper_id === paper.id);
  const fileless = library.filter((item) => !item.paper_id);
  async function add() {
    setWorking(true);
    setMessage('');
    const client = createScholarClient({});
    const result: ProjectPaper[] = [];
    const missing: string[] = [];
    for (const paper of papers)
      if (chosen.includes(`paper:${paper.id}`))
        result.push(projectPaperFromPaper(paper, linked(paper), metadata.get(paper.id)));
    for (const item of fileless) {
      if (!chosen.includes(`library:${item.id}`)) continue;
      let abstract: string | null;
      try {
        abstract = await client.workAbstract(item.doi);
      } catch {
        abstract = null;
      }
      if (!abstract) missing.push(item.id);
      result.push(projectPaperFromLibrary(item, abstract));
    }
    setWorking(false);
    onAdd(result);
    setChosen([]);
    setMissingAbstractIds(missing);
    if (missing.length)
      setMessage(`${missing.length} bài không lấy được tóm tắt; bài lỗi đã được đánh dấu trong danh sách.`);
    else onClose();
  }
  return (
    <Drawer
      open
      onClose={onClose}
      label="Thêm bài"
      side="right"
      size="lg"
      title="Thêm bài vào project"
      description="Chọn bài toàn văn hoặc abstract để đưa vào bảng trích xuất."
      footer={
        <div className={styles.addPaperFooter}>
          {message ? (
            <p className={styles.addPaperMessage} role="status">
              {message}
            </p>
          ) : null}
          <div className={styles.addPaperStatus}>
            <strong>{working ? 'Đang lấy abstract…' : `Đã chọn ${chosen.length} bài`}</strong>
            <span>Với DOI, chỉ mã DOI được gửi tới OpenAlex.</span>
          </div>
          <Button
            className={styles.addPaperButton}
            variant="primary"
            disabled={!chosen.length || working}
            onClick={() => void add()}
          >
            {working && <LoaderCircle className={styles.spinner} size={16} aria-hidden="true" />}
            {working
              ? 'Đang thêm…'
              : retryCount > 0 && retryCount === chosen.length
                ? 'Thử lại abstract'
                : 'Thêm vào project'}
          </Button>
        </div>
      }
    >
      <div className={styles.paperSections}>
        <section className={styles.paperGroup} aria-labelledby="imported-paper-group">
          <header className={styles.paperGroupHead}>
            <h3 id="imported-paper-group">Bài đã nhập</h3>
            <span>Đọc toàn văn · {papers.length}</span>
          </header>
          {papers.length === 0 ? (
            <p className={styles.groupEmpty}>Chưa có bài nào được nhập.</p>
          ) : (
            <ul className={styles.paperOptions}>
              {papers.map((paper) => {
                const key = `paper:${paper.id}`;
                return (
                  <li className={styles.paperOption} key={key}>
                    <Checkbox
                      disabled={inProject(key)}
                      checked={inProject(key) || chosen.includes(key)}
                      onChange={(event) => toggle(key, event.target.checked)}
                    >
                      <span className={styles.paperOptionText}>
                        {projectPaperFromPaper(paper, linked(paper), metadata.get(paper.id)).title}
                      </span>
                    </Checkbox>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className={styles.paperGroup} aria-labelledby="doi-paper-group">
          <header className={styles.paperGroupHead}>
            <h3 id="doi-paper-group">Thư viện DOI chưa có tệp</h3>
            <span>Đọc abstract · {fileless.length}</span>
          </header>
          {fileless.length === 0 ? (
            <p className={styles.groupEmpty}>Không có DOI nào chưa có tệp.</p>
          ) : (
            <ul className={styles.paperOptions}>
              {fileless.map((item) => {
                const key = `library:${item.id}`;
                const existingPaper = paperInProject(key);
                const abstractMissing =
                  existingPaper?.access === 'METADATA_ONLY' || missingAbstractIds.includes(item.id);
                const alreadyAvailable = Boolean(existingPaper) && !abstractMissing;
                return (
                  <li
                    className={`${styles.paperOption} ${abstractMissing ? styles.paperOptionWarning : ''}`}
                    key={key}
                  >
                    <Checkbox
                      disabled={alreadyAvailable}
                      checked={alreadyAvailable || chosen.includes(key)}
                      onChange={(event) => toggle(key, event.target.checked)}
                    >
                      <span className={styles.paperOptionContent}>
                        <span className={styles.paperOptionText}>
                          {item.title ?? item.doi} {item.year ? `(${item.year})` : ''}
                        </span>
                        {abstractMissing && (
                          <Badge tone="warning">
                            {missingAbstractIds.includes(item.id)
                              ? 'Không lấy được abstract · Có thể thử lại'
                              : 'Chưa có abstract · Có thể thử lại'}
                          </Badge>
                        )}
                      </span>
                    </Checkbox>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}
