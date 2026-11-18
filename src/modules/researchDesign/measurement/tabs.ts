export type Tab = 'chain' | 'variables' | 'metrics' | 'datasets' | 'conditions';
export type ListTab = Exclude<Tab, 'chain'>;

export const tabLabels: Record<Tab, string> = {
  chain: 'Chuỗi',
  variables: 'Variable',
  metrics: 'Metric',
  datasets: 'Dataset',
  conditions: 'Điều kiện',
};

/** The area keeps its section in `design`; the measurement tab sits beside it so links keep both. */
export const TAB_PARAM = 'measure';

export function tabHref(params: URLSearchParams, tab: Tab) {
  const next = new URLSearchParams(params);
  next.set('design', 'measurement');
  next.set(TAB_PARAM, tab);
  return `?${next.toString()}`;
}

export function readTab(params: URLSearchParams): Tab {
  const raw = params.get(TAB_PARAM) ?? 'chain';
  return raw in tabLabels ? (raw as Tab) : 'chain';
}
