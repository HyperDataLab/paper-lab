import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Corpus, ExtractionProject } from '@/core/schemas';
import { linkTopic, promoteProject } from '@/core/corpus/topic';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Select } from '@/shared/ui/Select';
import { Button } from '@/shared/ui/Button';
import { ResearchDesignArea } from '@/modules/researchDesign';
import { DeepResearch } from './DeepResearch';
import styles from './extraction.module.css';

export default function ProjectPage() {
  const { id } = useParams();
  const repo = useRepositories();
  const [project, setProject] = useState<ExtractionProject | null>(null);
  const [error, setError] = useState('');
  const [corpora, setCorpora] = useState<Corpus[]>([]);
  const [corpusId, setCorpusId] = useState('');
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
  if (!project) return <p>{error ? 'Không tải được project.' : 'Đang tải…'}</p>;
  const save = async (next: ExtractionProject, event?: Parameters<typeof repo.extraction.save>[1]) => {
    try {
      setProject(await repo.extraction.save(next, event));
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <div className={styles.projectWorkspace}>
      <header className={styles.projectHeader}>
        <Link className={styles.backLink} to="/extraction">
          ← Các project
        </Link>
        <h1>{project.title}</h1>
        {project.researchQuestion && (
          <p className={styles.note}>Research question: {project.researchQuestion}</p>
        )}
      </header>
      <section>
        <h2>Corpus chủ đề</h2>
        {project.corpusId && <Link to={`/corpus/${project.corpusId}`}>Mở corpus đã liên kết</Link>}
        <Select label="Chọn corpus" value={corpusId} onChange={(event) => setCorpusId(event.target.value)}>
          <option value="">Chọn corpus</option>
          {corpora
            .filter((item) => item.kind === 'topic')
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
        </Select>
        <Button
          type="button"
          disabled={!corpusId}
          onClick={() => {
            const corpus = corpora.find((item) => item.id === corpusId);
            if (corpus) void save(linkTopic(project, corpus));
          }}
        >
          Liên kết với Extraction
        </Button>
        <Button
          type="button"
          onClick={() => {
            const corpus = promoteProject(project, crypto.randomUUID(), new Date().toISOString());
            void repo.corpora
              .save(corpus)
              .then(async (saved) => {
                setCorpora((items) => [saved, ...items]);
                await save(linkTopic(project, saved));
              })
              .catch((cause: unknown) => setError(String(cause)));
          }}
        >
          Tạo corpus từ dự án
        </Button>
      </section>
      {error && <p role="alert">Có lỗi xảy ra: {error}</p>}
      {!project.paperId && <ResearchDesignArea project={project} />}
      <DeepResearch project={project} onSave={save} />
    </div>
  );
}
