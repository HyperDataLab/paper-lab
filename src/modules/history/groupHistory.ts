export interface HistoryItem {
  id: string;
  title?: string | null;
  preview: string;
  paperId: string | null;
}

export interface HistoryEntry<T> {
  item: T;
  /** The name shown inside its group. */
  label: string;
  /** The name that still makes sense outside its group. */
  fullLabel: string;
}

export interface HistorySection<T> {
  heading: string | null;
  entries: HistoryEntry<T>[];
}

export interface HistoryGroup<T> {
  key: string;
  title: string;
  count: number;
  sections: HistorySection<T>[];
}

const FROM_PAPER = /^(.*) · sec\d+_p0*(\d+)$/u;

/** Turns a flat history into paper → section → paragraph, hiding internal paragraph ids. */
export function groupHistory<T extends HistoryItem>(
  items: T[],
  paperTitles: Map<string, string>,
): HistoryGroup<T>[] {
  const groups = new Map<string, HistoryGroup<T>>();
  for (const item of items) {
    const title = item.title || item.preview;
    const match = FROM_PAPER.exec(title);
    const key = item.paperId ?? (match ? 'unknown-paper' : 'direct');
    const groupTitle =
      (item.paperId && paperTitles.get(item.paperId)) || (match ? 'Bài báo đã xoá' : 'Đoạn nhập trực tiếp');
    const group = groups.get(key) ?? { key, title: groupTitle, count: 0, sections: [] };
    groups.set(key, group);
    group.count += 1;
    const heading = match?.[1] ?? null;
    let section = group.sections.find((candidate) => candidate.heading === heading);
    if (!section) {
      section = { heading, entries: [] };
      group.sections.push(section);
    }
    section.entries.push(
      match
        ? { item, label: `Đoạn ${match[2]}`, fullLabel: `${match[1]}, đoạn ${match[2]}` }
        : { item, label: title, fullLabel: title },
    );
  }
  return [...groups.values()];
}
