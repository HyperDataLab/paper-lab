import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ExtractionProject } from '@/core/schemas';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { DeepResearch } from './DeepResearch';
import styles from './extraction.module.css';

export default function ProjectPage() {
  const { id } = useParams();
  const repo = useRepositories();
  const [project, setProject] = useState<ExtractionProject | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!id) return;
    void repo.extraction
      .get(id)
      .then((value) => setProject(value ?? null))
      .catch((cause: unknown) => setError(String(cause)));
  }, [id, repo]);
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
          <p className={styles.note}>Câu hỏi nghiên cứu: {project.researchQuestion}</p>
        )}
      </header>
      <DeepResearch project={project} onSave={save} />
    </div>
  );
}
