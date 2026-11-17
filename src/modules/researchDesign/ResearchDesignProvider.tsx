import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ExtractionProject } from '@/core/schemas';
import { emptyResearchDesign, type ResearchDesign } from '@/core/schemas/researchDesign';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { loadLocalData } from './localData';

type Data = Awaited<ReturnType<typeof loadLocalData>>;
type State =
  | { loading: true; error: null }
  | { loading: false; error: Error }
  | ({
      loading: false;
      error: null;
      project: ExtractionProject;
      design: ResearchDesign;
      bank: BankDoc | null;
      save: (update: (design: ResearchDesign) => ResearchDesign) => Promise<void>;
    } & Data);
const Context = createContext<State | null>(null);
export function ResearchDesignProvider({
  project,
  children,
}: {
  project: ExtractionProject;
  children: ReactNode;
}) {
  const repo = useRepositories();
  const [state, setState] = useState<State>({ loading: true, error: null });
  useEffect(() => {
    let active = true;
    void Promise.all([
      repo.researchDesigns.get(project.id),
      repo.researchDesigns.getBank(project.id),
      loadLocalData(project, repo),
    ])
      .then(([record, bank, data]) => {
        if (active)
          setState({
            loading: false,
            error: null,
            project,
            design: record ?? emptyResearchDesign(project.id),
            bank,
            ...data,
            save: async () => {},
          });
      })
      .catch((error: unknown) => {
        if (active)
          setState({ loading: false, error: error instanceof Error ? error : new Error(String(error)) });
      });
    return () => {
      active = false;
    };
  }, [project, repo]);
  const value =
    state.loading || state.error
      ? state
      : {
          ...state,
          save: async (update: (design: ResearchDesign) => ResearchDesign) => {
            const design = await repo.researchDesigns.save(update(state.design), state.design.version);
            setState((current) => (current.loading || current.error ? current : { ...current, design }));
          },
        };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useResearchDesign() {
  const value = useContext(Context);
  if (!value) throw new Error('ResearchDesignProvider is missing');
  return value;
}
