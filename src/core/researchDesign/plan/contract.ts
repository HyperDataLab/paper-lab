import { z } from 'zod';
import { examplePlan } from './examplePlan';
import { manifestSchema, planSchema } from './schema';

/** The public copies publish the same contracts as the source files. */
export function planContractFiles(): [string, unknown][] {
  const plan = z.toJSONSchema(planSchema);
  const manifest = z.toJSONSchema(manifestSchema);
  return [
    ['schemas/experiment-plan-v1.schema.json', plan],
    ['public/schemas/experiment-plan-v1.schema.json', plan],
    ['schemas/experiment-plan-manifest-v1.schema.json', manifest],
    ['public/schemas/experiment-plan-manifest-v1.schema.json', manifest],
    ['schemas/experiment-plan-v1.example.json', examplePlan()],
    ['public/schemas/experiment-plan-v1.example.json', examplePlan()],
  ];
}
