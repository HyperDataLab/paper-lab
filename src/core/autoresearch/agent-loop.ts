import { z, type ZodType } from 'zod';
import { text } from './contracts';

export const AGENT_STEP_LIMITS = { pi: 24, critic: 12 } as const;
export const readTools = [
  'list_artifacts',
  'read_artifact',
  'read_notebook',
  'search_lab_kg',
  'search_openalex',
  'lookup_writing_bank',
] as const;
export type ReadTool = (typeof readTools)[number];
const toolAction = z.strictObject({ action: z.enum(readTools), input: text.nullable() });
export const loopProgressSchema = z.strictObject({
  observations: z.array(text),
  pending: toolAction.nullable(),
});
export type LoopProgress = z.infer<typeof loopProgressSchema>;
export const emptyProgress: LoopProgress = { observations: [], pending: null };

export function nextActionSchema<T>(terminal: 'decide' | 'report', schema: ZodType<T>) {
  return z.strictObject({
    next: z.union([toolAction, z.strictObject({ action: z.literal(terminal), value: schema })]),
  });
}

export class AgentStepLimitError extends Error {
  constructor(readonly role: 'pi' | 'critic') {
    super(`AutoResearch ${role} step limit reached`);
  }
}

export async function runAgent<T>(options: {
  role: 'pi' | 'critic';
  schema: ZodType<T>;
  ask: (
    schema: ReturnType<typeof nextActionSchema<T>>,
    observations: string[],
  ) => Promise<z.infer<ReturnType<typeof nextActionSchema<T>>>>;
  read: (tool: ReadTool, input: string | null) => Promise<unknown>;
  guard: (value: T) => string[];
  checkpoint: (progress: LoopProgress, result: T | null) => Promise<void>;
  progress: LoopProgress;
  signal?: AbortSignal;
}) {
  const schema = nextActionSchema(options.role === 'pi' ? 'decide' : 'report', options.schema);
  const { role, signal, ask, checkpoint, read, guard } = options;
  let progress = options.progress;
  if (progress.pending) {
    signal?.throwIfAborted();
    const { action, input } = progress.pending;
    const observation = await read(action, input);
    signal?.throwIfAborted();
    progress = {
      pending: null,
      observations: [...progress.observations, JSON.stringify({ action, input, observation })],
    };
    await checkpoint(progress, null);
  }
  for (let step = progress.observations.length; step < AGENT_STEP_LIMITS[role]; step += 1) {
    signal?.throwIfAborted();
    const { next } = schema.parse(await ask(schema, progress.observations));
    signal?.throwIfAborted();
    if ('value' in next) {
      const errors = guard(next.value);
      if (errors.length === 0) {
        await checkpoint(progress, next.value);
        return next.value;
      }
      progress = {
        pending: null,
        observations: [...progress.observations, JSON.stringify({ guardErrors: errors })],
      };
    } else {
      await checkpoint({ ...progress, pending: next }, null);
      const observation = await read(next.action, next.input);
      signal?.throwIfAborted();
      progress = {
        pending: null,
        observations: [...progress.observations, JSON.stringify({ ...next, observation })],
      };
    }
    await checkpoint(progress, null);
  }
  throw new AgentStepLimitError(role);
}
