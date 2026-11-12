import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RUN_ALL, type JobId } from './paperJobs';
import {
  BLOCKS,
  BLOCK_IDS,
  DEFAULT_VIEW,
  SECTION_JOBS,
  SPACES,
  blockOf,
  blocksIn,
  isPane,
  isSpace,
  isView,
  modeOf,
  placeOf,
  type BlockId,
  type Mode,
  type Pane,
  type Place,
  type Space,
  type ViewId,
} from './paperPlaces';

const WIDE = '(min-width: 1024px)';
/** True on screens wide enough to show the paper and its analysis as two columns. */
function useWide() {
  const [wide, setWide] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(WIDE);
    const update = () => setWide(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}
function readSplit() {
  try {
    return localStorage.getItem('paper-split') !== 'false';
  } catch {
    return true;
  }
}

/** How far a column, or the page when the column does not scroll, has been scrolled. */
function scrollOf(column: HTMLElement | null) {
  const element = column && column.scrollHeight > column.clientHeight ? column : document.scrollingElement;
  return element?.scrollTop ?? 0;
}
function setScroll(column: HTMLElement | null, top: number) {
  const element = column && column.scrollHeight > column.clientHeight ? column : document.scrollingElement;
  if (element) element.scrollTop = top;
}

export type ReturnTo = { view: ViewId; label: string; scroll: number };

/**
 * Which column, tab, space and view of the paper page shows, the way back after a source opened the paper, and
 * the `?view=` address that lets a reload or a shared link land in the same place.
 */
export function usePaperNavigation() {
  const [query, setQuery] = useSearchParams();
  // The right column's view; the centre column's pane; and, on a narrow screen, which of the two shows.
  const initial = (() => {
    const view = query.get('view');
    return isView(view) ? view : null;
  })();
  const [tab, setTabState] = useState<ViewId>(() =>
    initial && !isPane(placeOf(initial)) ? initial : DEFAULT_VIEW.issues,
  );
  const [pane, setPaneState] = useState<Pane>(() => {
    const asked = query.get('pane');
    if (asked === 'fulltext' || asked === 'summary') return asked;
    const place = initial ? placeOf(initial) : 'fulltext';
    return isPane(place) ? place : 'fulltext';
  });
  const [focus, setFocus] = useState<'centre' | 'right'>(() =>
    initial && !isPane(placeOf(initial)) ? 'right' : 'centre',
  );
  // An AI panel stays mounted once opened, so its run keeps going while the reader looks elsewhere.
  const [opened, setOpened] = useState<JobId[]>(RUN_ALL);
  const [openBlocks, setOpenBlocks] = useState<BlockId[]>(() => {
    const first = initial && blockOf(initial);
    return first ? [first] : [];
  });
  const [blockView, setBlockView] = useState<Partial<Record<BlockId, ViewId>>>(() => {
    const first = initial && blockOf(initial);
    return first && initial ? { [first]: initial } : {};
  });
  // Leaving a space returns to the tab of the right column the reader came from.
  const beforeSpace = useRef<ViewId>(DEFAULT_VIEW.issues);
  const rightColumn = useRef<HTMLElement>(null);
  const centreColumn = useRef<HTMLElement>(null);
  // Where the reader was before a source took them to the PDF, so one press brings them back there.
  const [returnTo, setReturnTo] = useState<ReturnTo | null>(null);
  const wide = useWide();
  const [splitWanted, setSplitWanted] = useState(readSplit);

  /** Opens a view in its column and records it in the address, so a reload or a shared link lands there. */
  const setTab = (view: ViewId) => {
    const place = placeOf(view);
    // Going anywhere but the paper ends the way back.
    if (view !== 'map') setReturnTo(null);
    if (!isPane(place) && isSpace(place) && !isSpace(modeOf(tab))) beforeSpace.current = tab;
    const block = blockOf(view);
    // Every analysis of the place being shown is mounted, so each row can say what a run would cost.
    // What is left keeps its panels too, so nothing running there is interrupted.
    const jobsOf = (target: Place) =>
      blocksIn(target)
        .map((id) => BLOCKS[id].job)
        .filter((job): job is JobId => job !== undefined);
    const kept = [...jobsOf(modeOf(tab)), ...(isPane(place) ? jobsOf('summary') : jobsOf(place))];
    setOpened((old) => [...new Set([...old, ...kept])]);
    if (isPane(place)) {
      setPaneState(place);
      setFocus('centre');
      // Choosing the paper leaves a space: the right column comes back as it was.
      if (isSpace(modeOf(tab))) setTabState(beforeSpace.current);
    } else {
      setTabState(view);
      setFocus('right');
    }
    if (block) {
      setOpenBlocks((old) => (old.includes(block) ? old : [...old, block]));
      setBlockView((old) => ({ ...old, [block]: view }));
      window.setTimeout(
        () => document.getElementById(`block-${block}`)?.scrollIntoView?.({ block: 'start' }),
        0,
      );
    }
    setQuery(
      (old) => {
        const next = new URLSearchParams(old);
        next.set('view', view);
        if (isPane(place)) next.set('pane', place);
        return next;
      },
      { replace: true },
    );
  };

  const mode = modeOf(tab);
  // The paper is the centre of the page: on a wide screen it is always beside the analysis, so a quote opens
  // there. On a narrow screen showing the analysis, the quote opens in a drawer to keep the reader's place.
  // A space takes the whole width; the paper's passages then open in the evidence drawer.
  const inSpace = isSpace(mode);
  const showRight = !wide || splitWanted || inSpace;
  const centreVisible = !inSpace && (wide || focus === 'centre');

  const toggleSplit = () => {
    const next = !splitWanted;
    setSplitWanted(next);
    try {
      localStorage.setItem('paper-split', String(next));
    } catch {
      /* Storage may be unavailable. */
    }
  };
  const remember = (view: ViewId, label: string, column: HTMLElement | null) =>
    setReturnTo({ view, label, scroll: scrollOf(column) });
  /** A source opened from a space or the summary shows the paper, with a way back to where it was opened. */
  const enterReader = () => {
    const space = SPACES.find((item) => item.id === modeOf(tab));
    setTab('map');
    if (space) remember(tab, space.label, rightColumn.current);
    else if (pane === 'summary') remember('profile', 'Summary', centreColumn.current);
  };
  /** A passage opened beside the analysis shows the full text, with a way back to the summary. */
  const showFulltext = () => {
    if (pane === 'summary') remember('profile', 'Summary', centreColumn.current);
    setPaneState('fulltext');
  };
  /** A link to a passage shows the full text in the centre column. */
  const focusFulltext = useCallback(() => {
    setPaneState('fulltext');
    setFocus('centre');
  }, []);
  /** Back to where the source was opened from, at the same scroll position. */
  const goBack = () => {
    if (!returnTo) return;
    const { view, scroll } = returnTo;
    setTab(view);
    const column = isSpace(modeOf(view)) ? rightColumn : centreColumn;
    // After the tab has shown and setTab's own scroll to its block.
    window.setTimeout(() => setScroll(wide ? column.current : null, scroll), 50);
  };
  const leaveSpace = () => setTab(beforeSpace.current);
  const openSpace = (space: Space) => {
    // The parts that cost nothing are open on arrival.
    const free: BlockId[] = space === 'arguments' ? ['gap', 'mainClaims', 'atomics'] : ['vocabulary'];
    setOpenBlocks((old) => [...new Set<BlockId>([...old, ...free])]);
    const first = BLOCK_IDS.find((id) => BLOCKS[id].place === space);
    setTab((first && blockView[first]) ?? DEFAULT_VIEW[space]);
    // A space is entered at its top, where its overview is; after setTab's own scroll to the block.
    window.setTimeout(() => {
      const column = rightColumn.current;
      // On a wide screen the column scrolls on its own; on a narrow one the page does.
      if (wide) column?.scrollTo?.({ top: 0 });
      else column?.scrollIntoView?.({ block: 'start' });
    }, 0);
  };
  const openMode = (target: Mode) => {
    // A tab reopens the view the reader last had in it; a tab with no blocks has just its own view.
    const first = BLOCK_IDS.find((id) => BLOCKS[id].place === target);
    setTab((first && blockView[first]) ?? DEFAULT_VIEW[target]);
    if (!splitWanted && wide) toggleSplit();
  };
  const openBlock = (id: BlockId) => setOpenBlocks((old) => (old.includes(id) ? old : [...old, id]));
  const toggleBlock = (id: BlockId) =>
    setOpenBlocks((old) => (old.includes(id) ? old.filter((item) => item !== id) : [...old, id]));
  const prepareAll = () => setOpened((old) => [...new Set([...old, ...RUN_ALL])]);
  const viewOf = (id: BlockId) => blockView[id] ?? BLOCKS[id].views[0]?.id ?? 'profile';
  // The findings table offers section runs, so the analyses that can do one are mounted there too.
  const shown = (job: JobId) =>
    opened.includes(job) ||
    blocksIn(mode).some((id) => BLOCKS[id].job === job) ||
    (pane === 'summary' && blocksIn('summary').some((id) => BLOCKS[id].job === job)) ||
    (mode === 'issues' && SECTION_JOBS.includes(job));

  return {
    tab,
    pane,
    focus,
    mode,
    inSpace,
    showRight,
    centreVisible,
    wide,
    splitWanted,
    returnTo,
    openBlocks,
    rightColumn,
    centreColumn,
    setTab,
    toggleSplit,
    enterReader,
    showFulltext,
    focusFulltext,
    goBack,
    leaveSpace,
    openSpace,
    openMode,
    openBlock,
    toggleBlock,
    prepareAll,
    viewOf,
    shown,
  };
}

/** The navigation the page's parts read and act on; the column elements go to their columns on their own. */
export type PaperNavigation = Omit<ReturnType<typeof usePaperNavigation>, 'rightColumn' | 'centreColumn'>;
