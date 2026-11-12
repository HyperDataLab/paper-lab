import { lazy } from 'react';
import { Pilcrow } from 'lucide-react';
import type { ModuleDefinition } from '@/app/moduleTypes';
const module: ModuleDefinition = {
  id: 'evaluate',
  label: 'Đoạn văn',
  icon: Pilcrow,
  path: '/evaluate',
  group: 'analysis',
  order: 0,
  status: 'ready',
  page: lazy(() => import('./Page')),
};
export default module;
export { labels, statuses } from './issueLabels';
export { roleLabels, continuityLabels, relationLabels } from './roleLabels';
export { ParagraphModes } from './ParagraphModes';
export { ScoresView } from './ScoresView';
