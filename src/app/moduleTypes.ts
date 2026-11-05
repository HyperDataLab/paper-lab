import type { ComponentType, LazyExoticComponent } from 'react';
import type { LucideIcon } from 'lucide-react';
export interface ModuleDefinition {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  group: 'analysis' | 'data' | 'labs' | 'system';
  order: number;
  status: 'ready' | 'beta' | 'soon';
  page: LazyExoticComponent<ComponentType>;
}
