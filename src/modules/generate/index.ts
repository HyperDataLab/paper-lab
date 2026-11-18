import { lazy } from 'react';
import { PenLine } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';
const module: ModuleDefinition = {
  id: 'generate',
  label: 'Soạn paragraph',
  icon: PenLine,
  path: '/generate',
  group: 'analysis',
  order: 2,
  status: 'beta',
  page: lazy(() => import('./Page')),
  partOf: 'evaluate',
};
export default module;
