import { lazy } from 'react';
import { FileText } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';
const module: ModuleDefinition = {
  id: 'paper-import',
  label: 'Bài báo',
  icon: FileText,
  path: '/papers',
  group: 'paper',
  order: 0,
  status: 'beta',
  page: lazy(() => import('./Page')),
};
export default module;
