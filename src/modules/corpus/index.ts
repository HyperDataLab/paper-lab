import { lazy } from 'react';
import { LibraryBig } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';

const module: ModuleDefinition = {
  id: 'corpus',
  label: 'Corpus',
  icon: LibraryBig,
  path: '/corpus',
  group: 'paper',
  order: 2,
  status: 'beta',
  page: lazy(() => import('./Page')),
};
export default module;
