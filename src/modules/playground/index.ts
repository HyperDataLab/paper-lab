import { lazy } from 'react';
import { FlaskConical } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';

const module: ModuleDefinition = {
  id: 'playground',
  label: 'Playground',
  icon: FlaskConical,
  path: '/playground',
  group: 'labs',
  order: 1,
  status: 'beta',
  adminOnly: true,
  page: lazy(() => import('./Page')),
};
export default module;
