import type { Stage } from '@/core/autoresearch/contracts';
import type { Run } from '@/core/autoresearch/record';
import { PlanPackageSection } from '@/modules/researchDesign';
import { CopyDesignAction } from './CopyDesignAction';
import type { experimentStageState } from './experimentStageState';
import { ResultsImport } from './ResultsImport';

export function ExperimentStageActions({
  run,
  stage,
  state,
  busy,
  connect,
  save,
}: {
  run: Run;
  stage: Stage;
  state: ReturnType<typeof experimentStageState>;
  busy: boolean;
  connect: (version: number) => Promise<boolean>;
  save: (raw: string, format: 'json' | 'csv') => Promise<boolean>;
}) {
  if (stage === 'S10') return <CopyDesignAction run={run} disabled={busy || run.status !== 'waiting'} />;
  if (stage === 'S11')
    return state.canLock ? (
      <PlanPackageSection autoResearch={{ run, busy, connect }} />
    ) : (
      <p>Duyệt Experiment design để mở quyết định đóng băng.</p>
    );
  if (stage === 'S12')
    return state.lock?.status === 'accepted' ? (
      <ResultsImport
        key={state.lock.hash}
        loaded={!!state.log}
        disabled={busy || run.status === 'running'}
        save={save}
      />
    ) : (
      <p>Gắn kế hoạch đã đóng băng vào run để nhập results log.</p>
    );
  return null;
}
