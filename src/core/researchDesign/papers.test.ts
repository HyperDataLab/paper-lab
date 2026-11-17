import { expectTypeOf, it } from 'vitest';
import type { PaperModel } from '@/core/schemas/paperModel';
import type { PaperModelView } from './papers';

it('PaperLab PaperModel satisfies the Research Design paper model view', () => {
  expectTypeOf<PaperModel>().toExtend<PaperModelView>();
});
