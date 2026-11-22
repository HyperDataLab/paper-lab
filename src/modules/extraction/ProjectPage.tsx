import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Database, ExternalLink, LoaderCircle } from 'lucide-react';
import type { Corpus, ExtractionProject } from '@/core/schemas';
import { linkTopic, promoteProject } from '@/core/corpus/topic';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Select } from '@/shared/ui/Select';
import { Button } from '@/shared/ui/Button';
import { Dialog, DialogActions } from '@/shared/ui/Dialog';
import { ProjectResearch } from './ProjectResearch';
import styles from './extraction.module.css';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

export default function ProjectPage() {
  const { id } = useParams();
  const repo = useRepositories();
  const [project, setProject] = useState<ExtractionProject | null>();
  const [error, setError] = useState('');
  const [corpora, setCorpora] = useState<Corpus[]>([]);
  const [corpusId, setCorpusId] = useState('');
  const [corpusDialog, setCorpusDialog] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('saved');

  useEffect(() => {
    if (!id) return;
    void repo.extraction
      .get(id)
      .then((value) => setProject(value ?? null))
      .catch((cause: unknown) => setError(String(cause)));
  }, [id, repo]);
  useEffect(() => {
    void repo.corpora
      .list()
      .then(setCorpora)
      .catch((cause: unknown) => setError(String(cause)));
  }, [repo]);
  if (!project) {
    if (error) return <p role="alert">Không tải được project. {error}</p>;
    if (project === null) return <p role="status">Không tìm thấy project.</p>;
    return (
      <section className={styles.projectLoadingState} role="status" aria-live="polite" aria-busy="true">
        <div className={styles.projectLoadingIntro}>
          <span className={styles.projectLoadingIcon} aria-hidden="true">
            <LoaderCircle size={22} />
          </span>
          <div>
            <span className={styles.projectLoadingEyebrow}>PROJECT WORKSPACE</span>
            <h1>Đang tải project</h1>
            <p>Đang lấy thiết kế nghiên cứu và dữ liệu liên quan…</p>
          </div>
        </div>
        <div className={styles.projectLoadingPreview} aria-hidden="true">
          <div className={styles.projectLoadingTitleLine}>
            <span />
            <span />
          </div>
          <div className={styles.projectLoadingTabs}>
            <span />
            <span />
          </div>
          <div className={styles.projectLoadingColumns}>
            <div>
              <span />
              <span />
              <span />
            </div>
            <div>
              <span />
              <span />
            </div>
          </div>
        </div>
      </section>
    );
  }

  const save = async (next: ExtractionProject) => {
    setSaveState('saving');
    try {
      const saved = await repo.extraction.save(next);
      setProject(saved);
      setError('');
      setSaveState('saved');
    } catch (cause) {
      setSaveState('error');
      setError(String(cause));
      throw cause;
    }
  };

  const linkCorpus = async (corpus: Corpus) => {
    try {
      await save(linkTopic(project, corpus));
      setCorpusDialog(false);
    } catch {
      // `save` keeps the error visible in the page status.
    }
  };

  const createCorpus = async () => {
    const corpus = promoteProject(project, crypto.randomUUID(), new Date().toISOString());
    try {
      const saved = await repo.corpora.save(corpus);
      setCorpora((items) => [saved, ...items]);
      await linkCorpus(saved);
    } catch (cause) {
      setSaveState('error');
      setError(String(cause));
    }
  };

  const linkedCorpus = corpora.find((item) => item.id === project.corpusId);

  return (
    <div className={styles.projectWorkspace}>
      <header className={styles.projectHeader}>
        <div className={styles.projectIdentity}>
          <nav className={styles.projectBreadcrumb} aria-label="Breadcrumb">
            <Link to="/extraction">Projects</Link>
            <ChevronRight size={14} aria-hidden="true" />
            <span aria-current="page">{project.title}</span>
          </nav>
          <h1>{project.title}</h1>
          {project.researchQuestion && <p>{project.researchQuestion}</p>}
          <span className={styles.saveStatus} role="status" data-state={saveState}>
            {saveState === 'saving'
              ? 'Đang lưu thay đổi…'
              : saveState === 'error'
                ? 'Chưa lưu được thay đổi'
                : saveState === 'dirty'
                  ? 'Thay đổi chưa lưu'
                  : 'Đã lưu'}
          </span>
        </div>
        <aside className={styles.corpusSummary} aria-label="Corpus của project">
          <span className={styles.corpusIcon} aria-hidden="true">
            <Database size={18} />
          </span>
          <div className={styles.corpusInfo}>
            <span className={styles.corpusLabel}>Corpus</span>
            {linkedCorpus ? (
              <Link to={`/corpus/${linkedCorpus.id}`} className={styles.corpusName}>
                {linkedCorpus.title} <ExternalLink size={13} aria-hidden="true" />
              </Link>
            ) : (
              <span className={styles.corpusNameMuted}>Chưa liên kết corpus</span>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => {
              setCorpusId(project.corpusId ?? '');
              setCorpusDialog(true);
            }}
          >
            {linkedCorpus ? 'Đổi corpus' : 'Chọn corpus'}
          </Button>
        </aside>
      </header>

      {error && (
        <p role="alert" className={styles.projectError}>
          Có lỗi xảy ra: {error}
        </p>
      )}
      <ProjectResearch project={project} onSave={save} onDraftChange={() => setSaveState('dirty')} />

      {corpusDialog && (
        <Dialog
          kind="form"
          title={project.corpusId ? 'Thay đổi corpus liên kết' : 'Liên kết corpus'}
          description="Chọn corpus chủ đề hiện có hoặc tạo corpus mới từ câu hỏi và dữ liệu của project."
          onClose={() => setCorpusDialog(false)}
        >
          <div className={styles.corpusDialogContent}>
            <Select
              label="Corpus hiện có"
              value={corpusId}
              onChange={(event) => setCorpusId(event.target.value)}
            >
              <option value="">Chọn corpus</option>
              {corpora
                .filter((item) => item.kind === 'topic')
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
            </Select>
            <DialogActions>
              <Button onClick={() => setCorpusDialog(false)}>Huỷ</Button>
              <Button
                variant="primary"
                disabled={!corpusId || saveState === 'saving'}
                onClick={() => {
                  const corpus = corpora.find((item) => item.id === corpusId);
                  if (corpus) void linkCorpus(corpus);
                }}
              >
                Liên kết corpus
              </Button>
            </DialogActions>
            <div className={styles.corpusCreate}>
              <div>
                <strong>Chưa có corpus phù hợp?</strong>
                <span>Tạo corpus chủ đề từ project này.</span>
              </div>
              <Button disabled={saveState === 'saving'} onClick={() => void createCorpus()}>
                Tạo corpus mới
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
