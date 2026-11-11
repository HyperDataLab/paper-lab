import { lazy } from 'react';
import { Table2 } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';
const module: ModuleDefinition = {
  id: 'extraction',
  label: 'Trích xuất',
  icon: Table2,
  path: '/extraction',
  group: 'paper',
  order: 1,
  status: 'beta',
  page: lazy(() => import('./Page')),
};
export default module;
export { AddColumns } from './AddColumns';
export { CellDrawer } from './CellDrawer';
export { RunPanel } from './RunPanel';
export { STATUS } from './labels';
export { useExtractionRun } from './useExtractionRun';
