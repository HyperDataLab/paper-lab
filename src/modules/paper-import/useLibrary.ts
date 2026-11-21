import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_DOIS_PER_ADD, titleMatchesText } from '@/core/library';
import type { LibraryItem } from '@/core/schemas';
import { createScholarClient, type ScholarClient } from '@/shared/scholar/client';
import { getScholarEmail } from '@/shared/scholar/settings';
import { useHubProjectId, useRepositories } from '@/shared/storage/StorageProvider';
import { useAuth } from '@/shared/auth/authContext';
import { useGrobidQueue } from '@/shared/pdfStore/useGrobidQueue';
import { importPaperFile } from './importPaperFile';

const CONCURRENCY = 2;
/** arXiv asks automated clients to leave a few seconds between requests. */
const ARXIV_GAP_MS = 3000;
const fileName = (item: LibraryItem) => `${item.doi.replace(/[^a-z0-9.-]+/giu, '_')}.pdf`;

export function useLibrary(
  makeClient: () => ScholarClient = () => createScholarClient({ email: getScholarEmail() }),
) {
  const repo = useRepositories();
  const projectId = useHubProjectId() ?? '';
  const { getIdToken } = useAuth();
  const grobid = useGrobidQueue();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState({ finished: 0, total: 0 });
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const client = useRef(makeClient);
  const apply = useCallback((next: LibraryItem) => {
    setItems((old) => old.map((item) => (item.id === next.id ? next : item)));
  }, []);
  useEffect(() => {
    let active = true;
    void repo.library
      .list()
      .then((value) => {
        if (active) setItems(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [repo]);

  const lookupAll = useCallback(
    async (targets: LibraryItem[]) => {
      if (!targets.length) return;
      const abort = new AbortController();
      controller.current = abort;
      setRunning(true);
      setDone({ finished: 0, total: targets.length });
      const scholar = client.current();
      const queue = [...targets];
      const worker = async () => {
        for (let item = queue.shift(); item && !abort.signal.aborted; item = queue.shift()) {
          const current = item;
          try {
            const outcome = await scholar.lookupDoi(current.doi, abort.signal);
            apply(
              await repo.library.update(
                current.id,
                outcome.found
                  ? { ...outcome.patch, lookup: 'done', error: null }
                  : { lookup: 'not_found', access: 'unknown', error: null },
              ),
            );
          } catch (cause) {
            if (abort.signal.aborted) return;
            apply(await repo.library.update(current.id, { lookup: 'failed', error: String(cause) }));
          }
          setDone((old) => ({ ...old, finished: old.finished + 1 }));
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (controller.current === abort) controller.current = null;
      setRunning(false);
    },
    [apply, repo],
  );

  async function add(dois: string[]) {
    if (dois.length > MAX_DOIS_PER_ADD) throw new Error(`Mỗi lần thêm tối đa ${MAX_DOIS_PER_ADD} DOI.`);
    const result = await repo.library.addDois(dois);
    setItems((old) => [...result.added, ...old]);
    void lookupAll(result.added);
    return { added: result.added.length, duplicates: result.duplicates };
  }
  async function retry(targets: LibraryItem[]) {
    const reset = await Promise.all(
      targets.map((item) => repo.library.update(item.id, { lookup: 'pending', error: null })),
    );
    reset.forEach(apply);
    await lookupAll(reset);
  }
  async function remove(ids: string[]) {
    await repo.library.remove(ids);
    setItems((old) => old.filter((item) => !ids.includes(item.id)));
  }
  async function attach(item: LibraryItem, file: File) {
    const paper = await importPaperFile(file, repo, {
      projectId,
      title: item.title,
      reuseExisting: true,
      getIdToken,
    });
    const text = paper.paragraphs
      .slice(0, 12)
      .map((paragraph) => paragraph.text)
      .join(' ');
    apply(
      await repo.library.update(item.id, {
        paper_id: paper.id,
        file_matches_title: titleMatchesText(item.title, `${paper.source.fileName} ${text}`),
        error: null,
      }),
    );
    try {
      grobid.enqueue(item.id, paper);
    } catch {
      // Background processing must not change the outcome of importing the PDF.
    }
  }
  async function downloadArxiv(targets: LibraryItem[]) {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setDone({ finished: 0, total: targets.length });
    const scholar = client.current();
    try {
      for (const [index, item] of targets.entries()) {
        if (abort.signal.aborted) break;
        if (index > 0) await new Promise((resolve) => setTimeout(resolve, ARXIV_GAP_MS));
        try {
          if (item.arxiv_id)
            await attach(item, await scholar.downloadArxivPdf(item.arxiv_id, fileName(item), abort.signal));
        } catch (cause) {
          if (abort.signal.aborted) break;
          apply(await repo.library.update(item.id, { error: `Không tải được: ${String(cause)}` }));
        }
        setDone((old) => ({ ...old, finished: old.finished + 1 }));
      }
    } finally {
      if (controller.current === abort) controller.current = null;
      setRunning(false);
    }
  }
  return {
    items,
    grobidStatuses: grobid.statuses,
    loading,
    running,
    done,
    error,
    add,
    retry,
    remove,
    attach,
    downloadArxiv,
    lookupAll,
    cancel: () => controller.current?.abort(),
  };
}
