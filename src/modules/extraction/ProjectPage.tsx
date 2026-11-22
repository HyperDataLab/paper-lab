import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Corpus, ExtractionProject } from '@/core/schemas';
import { linkTopic, promoteProject } from '@/core/corpus/topic';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { Select } from '@/shared/ui/Select';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { PageHeader } from '@/shared/ui/PageHeader';
import { ProjectResearch } from './ProjectResearch';
import { DeepResearch } from './DeepResearch';
import styles from './extraction.module.css';

export default function ProjectPage() {
  const { id } = useParams();
  const repo = useRepositories();
  const [project, setProject] = useState<ExtractionProject | null>();
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
  if (!project) {
    if (error) return <p>Không tải được project.</p>;
    return <p>{project === null ? 'Không tìm thấy project.' : 'Đang tải…'}</p>;
  }
  const save = async (next: ExtractionProject, event?: Parameters<typeof repo.extraction.save>[1]) => {
    try {
      setProject(await repo.extraction.save(next, event));
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <div className={styles.projectWorkspace}>
      <PageHeader
        title={project.title}
        lead={project.researchQuestion ? `Research question: ${project.researchQuestion}` : undefined}
      >
        <Link className={styles.backLink} to="/extraction">
          ← Các project
        </Link>
      </PageHeader>
      <Card padding="md">
        <section className={styles.projectCorpus} aria-labelledby="project-corpus-title">
          <div>
            <h2 id="project-corpus-title">Corpus chủ đề</h2>
            <p>Liên kết corpus đang có hoặc tạo corpus mới từ câu hỏi nghiên cứu này.</p>
          </div>
          <div className={styles.projectCorpusControls}>
            <Select
              label="Chọn corpus"
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
            <Button
              type="button"
              disabled={!corpusId}
              onClick={() => {
                const corpus = corpora.find((item) => item.id === corpusId);
                if (corpus) void save(linkTopic(project, corpus));
              }}
            >
              Liên kết corpus
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
              Tạo corpus
            </Button>
            {project.corpusId && <Link to={`/corpus/${project.corpusId}`}>Mở corpus liên kết</Link>}
          </div>
        </section>
      </Card>
      {error && <p role="alert">Có lỗi xảy ra: {error}</p>}
      {!project.paperId && <ProjectResearch project={project} />}
      <DeepResearch
        project={project}
        onSave={save}
        screeningStorage={{
          checkpoint: async (next) => {
            setProject(await repo.extraction.checkpoint(next));
          },
          finish: async (events) => {
            await repo.extraction.flush(project.id);
            await repo.extraction.recordEvents(project.id, events);
          },
        }}
      />
    </div>
  );
}
