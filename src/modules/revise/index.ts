import { lazy } from 'react';
import { Pencil } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';
const module: ModuleDefinition = {
  id: 'revise',
  label: 'Chỉnh sửa',
  icon: Pencil,
  path: '/revise',
  group: 'analysis',
  order: 1,
  status: 'beta',
  page: lazy(() => import('./Page')),
  partOf: 'evaluate',
  hiddenFromSearch: true,
};
export default module;
export { checkLabels } from './checkLabels';
