import { FolderKey } from 'lucide-react';
import { ActivityStatus } from '@/shared/ui/ActivityStatus';
import styles from './project-access-gate.module.css';

export function ProjectAccessGate({
  title,
  description,
  statusLabel,
}: {
  title: string;
  description: string;
  statusLabel: string;
}) {
  return (
    <section className={styles.stage} aria-labelledby="project-access-title">
      <div className={styles.panel}>
        <span className={styles.icon} aria-hidden="true">
          <FolderKey size={21} strokeWidth={1.8} />
        </span>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>ResearchHub</p>
          <h1 id="project-access-title">{title}</h1>
          <p className={styles.description}>{description}</p>
        </div>
        <div className={styles.status}>
          <ActivityStatus label={statusLabel} />
        </div>
      </div>
    </section>
  );
}
