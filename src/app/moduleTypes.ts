import type { ComponentType, LazyExoticComponent } from 'react';
import type { LucideIcon } from 'lucide-react';
export interface ModuleDefinition {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  group: 'home' | 'analysis' | 'paper' | 'data' | 'labs' | 'system';
  order: number;
  status: 'ready' | 'beta' | 'soon';
  page: LazyExoticComponent<ComponentType>;
  /** A screen reached from another module: it has its route but no sidebar entry of its own. */
  partOf?: string;
  /** Needs context from another screen, so opening it from search would show nothing useful. */
  hiddenFromSearch?: boolean;
  /** Listed in the sidebar and search only when the lab server says the account is an admin (`useAdmin`). */
  adminOnly?: boolean;
}
