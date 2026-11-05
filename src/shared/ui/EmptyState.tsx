import { Card } from './Card';
import styles from './ui.module.css';
export function EmptyState({
  title,
  description,
  detail,
}: {
  title: string;
  description: string;
  detail: string;
}) {
  return (
    <Card>
      <div className={styles.empty}>
        <h1>{title}</h1>
        <p>{description}</p>
        <span className={styles.detail}>{detail}</span>
      </div>
    </Card>
  );
}
