import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ExtractionProject } from '@/core/schemas';
import { emptyResearchDesign, type ResearchDesign } from '@/core/schemas/researchDesign';
import type { BankDoc } from '@/core/researchDesign/bank/snapshot';
import type { PapersDoc } from '@/core/researchDesign/papers';
import { ResearchDesignConflictError } from '@/shared/storage/errors';
import type { FreezeForRun } from '@/shared/storage/types';
import { useRepositories } from '@/shared/storage/StorageProvider';
import { loadLocalData } from './localData';

type Data = Awaited<ReturnType<typeof loadLocalData>>;
type Change = (design: ResearchDesign) => ResearchDesign;
type Loaded = { project: ExtractionProject; design: ResearchDesign; bank: BankDoc | null } & Data;
type Actions = {
  /** Kept for existing callers; same as `update` without the returned record. */
  save: (change: Change) => Promise<void>;
  /** Applies `change` to the stored record; re-reads and re-applies once when another save got there first. */
  update: (change: Change) => Promise<ResearchDesign>;
  /** Re-reads the design and the pinned bank (or the whole area after a load error). */
  reload: () => Promise<void>;
  importBank: (bytes: ArrayBuffer, who: string) => Promise<ResearchDesign>;
  freeze: (
    version: number,
    who: string,
    deviation: string | null,
    papers: PapersDoc,
    appVersion: string,
    lock?: FreezeForRun,
  ) => Promise<ResearchDesign>;
};
type State =
  | { loading: true; error: null }
  | { loading: false; error: Error; reload: () => Promise<void> }
  | ({ loading: false; error: null } & Loaded & Actions);
type Inner =
  { loading: true } | { loading: false; error: Error } | ({ loading: false; error: null } & Loaded);

const Context = createContext<State | null>(null);
const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

export function ResearchDesignProvider({
  project,
  children,
}: {
  project: ExtractionProject;
  children: ReactNode;
}) {
  const repo = useRepositories();
  const [state, setState] = useState<Inner>({ loading: true });
  const [loadCount, setLoadCount] = useState(0);
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
          });
      })
      .catch((error: unknown) => {
        if (active) setState({ loading: false, error: asError(error) });
      });
    return () => {
      active = false;
    };
  }, [project, repo, loadCount]);

  const patch = useCallback(
    (next: Partial<Loaded>) =>
      setState((current) => (current.loading || current.error ? current : { ...current, ...next })),
    [],
  );
  const read = useCallback(
    async () => (await repo.researchDesigns.get(project.id)) ?? emptyResearchDesign(project.id),
    [repo, project.id],
  );
  /** Runs `write` against the stored version; a version conflict gets one fresh read and one more try. */
  const withFreshVersion = useCallback(
    async (write: (current: ResearchDesign) => Promise<ResearchDesign>) => {
      for (let tries = 0; ; tries += 1) {
        const current = await read();
        try {
          return await write(current);
        } catch (error) {
          if (!(error instanceof ResearchDesignConflictError) || tries > 0) throw error;
        }
      }
    },
    [read],
  );

  const update = useCallback(
    async (change: Change) => {
      const design = await withFreshVersion((current) =>
        repo.researchDesigns.save(change(current), current.version),
      );
      patch({ design });
      return design;
    },
    [repo, withFreshVersion, patch],
  );
  const importBank = useCallback(
    async (bytes: ArrayBuffer, who: string) => {
      const design = await withFreshVersion((current) =>
        repo.researchDesigns.importBank(project.id, current.version, bytes, who),
      );
      patch({ design, bank: await repo.researchDesigns.getBank(project.id) });
      return design;
    },
    [repo, project.id, withFreshVersion, patch],
  );
  const freeze = useCallback<Actions['freeze']>(
    async (version, who, deviation, papers, appVersion, lock) => {
      // Only the record version is refreshed: the plan version stays the caller's, so a mismatch surfaces.
      const design = await withFreshVersion((current) =>
        repo.researchDesigns.freeze(
          project.id,
          current.version,
          version,
          who,
          deviation,
          papers,
          appVersion,
          lock,
        ),
      );
      patch({ design });
      return design;
    },
    [repo, project.id, withFreshVersion, patch],
  );
  const ready = !state.loading && !state.error;
  const reload = useCallback(async () => {
    await repo.researchDesigns.discard(project.id);
    // A ready area keeps its sections mounted so open dialogs survive; after a load error everything is read again.
    if (!ready) {
      setState({ loading: true });
      setLoadCount((value) => value + 1);
      return;
    }
    const [design, bank] = await Promise.all([read(), repo.researchDesigns.getBank(project.id)]);
    patch({ design, bank });
  }, [ready, read, repo, project.id, patch]);
  const save = useCallback(async (change: Change) => void (await update(change)), [update]);

  const value = useMemo<State>(() => {
    if (state.loading) return { loading: true, error: null };
    if (state.error) return { loading: false, error: state.error, reload };
    return { ...state, save, update, reload, importBank, freeze };
  }, [state, save, update, reload, importBank, freeze]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useResearchDesign() {
  const value = useContext(Context);
  if (!value) throw new Error('ResearchDesignProvider is missing');
  return value;
}
