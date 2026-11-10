import { useEffect, useState } from 'react';
import { projectPaperFromLibrary, projectPaperFromPaper } from '@/core/extraction';
import type { ExtractionProject, LibraryItem, Paper, ProjectPaper } from '@/core/schemas';
import { createScholarClient } from '@/shared/scholar/client';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { ActionBar } from '@/shared/ui/ActionBar';
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
  const [chosen, setChosen] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    void Promise.all([repo.papers.list(), repo.library.list()]).then(([savedPapers, items]) => {
      setPapers(savedPapers);
      setLibrary(items);
    });
  }, [repo]);
  const inProject = (key: string) => project.papers.some((paper) => paper.key === key);
  const toggle = (key: string, on: boolean) =>
    setChosen((old) => (on ? [...old, key] : old.filter((item) => item !== key)));
  const linked = (paper: Paper) => library.find((item) => item.paper_id === paper.id);
  const fileless = library.filter((item) => !item.paper_id);
  async function add() {
    setWorking(true);
    setMessage('');
    const client = createScholarClient({});
    const result: ProjectPaper[] = [];
    let missing = 0;
    for (const paper of papers)
      if (chosen.includes(`paper:${paper.id}`)) result.push(projectPaperFromPaper(paper, linked(paper)));
    for (const item of fileless) {
      if (!chosen.includes(`library:${item.id}`)) continue;
      let abstract: string | null;
      try {
        abstract = await client.workAbstract(item.doi);
      } catch {
        abstract = null;
      }
      if (!abstract) missing++;
      result.push(projectPaperFromLibrary(item, abstract));
    }
    setWorking(false);
    onAdd(result);
    if (missing) setMessage(`${missing} bài không lấy được tóm tắt, chỉ có metadata.`);
    else onClose();
  }
  return (
    <Drawer open onClose={onClose} label="Thêm bài" side="right">
      <div className={styles.drawer}>
        <header className={styles.drawerHead}>
          <h2>Thêm bài</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Đóng
          </Button>
        </header>
        <section>
          <h3>Bài đã nhập (đọc toàn văn)</h3>
          {papers.length === 0 && <p className={styles.note}>Chưa có bài nào được nhập.</p>}
          {papers.map((paper) => {
            const key = `paper:${paper.id}`;
            return (
              <Checkbox
                key={key}
                disabled={inProject(key)}
                checked={inProject(key) || chosen.includes(key)}
                onChange={(event) => toggle(key, event.target.checked)}
              >
                {linked(paper)?.title ?? paper.title}
              </Checkbox>
            );
          })}
        </section>
        <section>
          <h3>Thư viện DOI chưa có tệp (đọc tóm tắt)</h3>
          {fileless.length === 0 && <p className={styles.note}>Không có DOI nào chưa có tệp.</p>}
          {fileless.map((item) => {
            const key = `library:${item.id}`;
            return (
              <Checkbox
                key={key}
                disabled={inProject(key)}
                checked={inProject(key) || chosen.includes(key)}
                onChange={(event) => toggle(key, event.target.checked)}
              >
                {item.title ?? item.doi} {item.year ? `(${item.year})` : ''}
              </Checkbox>
            );
          })}
        </section>
        <ActionBar
          status={
            working ? (
              <span role="status">Đang lấy tóm tắt từ OpenAlex…</span>
            ) : (
              `Đã chọn ${chosen.length} bài. Với DOI, chỉ DOI được gửi tới OpenAlex.`
            )
          }
        >
          <Button variant="primary" disabled={!chosen.length || working} onClick={() => void add()}>
            Thêm vào project
          </Button>
        </ActionBar>
        {message && <p role="status">{message}</p>}
      </div>
    </Drawer>
  );
}
