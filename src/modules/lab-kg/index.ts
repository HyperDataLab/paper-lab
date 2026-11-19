import { lazy } from 'react';
import { Network } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';

const module: ModuleDefinition = {
  id: 'lab-kg',
  label: 'KG của lab',
  icon: Network,
  path: '/lab-kg',
  group: 'paper',
  order: 3,
  status: 'beta',
  page: lazy(() => import('./Page')),
};
export default module;
