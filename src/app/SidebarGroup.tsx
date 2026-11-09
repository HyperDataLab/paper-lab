import type { ModuleDefinition } from './moduleTypes';
import { modules } from './modules';
import { SidebarItem } from './SidebarItem';
import styles from './shell.module.css';

export function SidebarGroup({
  group,
  rail,
  onNavigate,
}: {
  group: { id: ModuleDefinition['group']; label: string };
  rail: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className={group.id === 'system' ? styles.system : styles.group}>
      {group.label && (
        <div className={styles.groupTitle}>
          {rail ? <span aria-label={group.label}>···</span> : group.label}
        </div>
      )}
      {modules
        .filter((item) => item.group === group.id && !item.partOf)
        .map((item) => (
          <SidebarItem key={item.id} item={item} rail={rail} onNavigate={onNavigate} />
        ))}
    </div>
  );
}
