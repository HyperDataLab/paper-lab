export const EXAMPLES: Record<string, Record<string, unknown>> = {
  search_papers: { query: 'large language models for title and abstract screening', limit: 5 },
  get_paper: { id: '10.1038/nature14539' },
  recommend_similar: { ids: ['10.1038/nature14539'], limit: 5 },
  run_duplication_test: {
    question: 'Can large language models replace human title and abstract screening in systematic reviews?',
    mode: 'sr',
    limit: 5,
  },
  check_gap_saturation: {
    gap_statement: 'large language models title abstract screening systematic reviews',
    window_years: 5,
  },
  map_topic_debate: { topic: 'LLM screening systematic reviews', limit: 8 },
  verify_reference: { citation: 'LeCun Y, Bengio Y, Hinton G. Deep learning. Nature 2015;521:436-444' },
  check_retractions: { dois: ['10.1038/nature14539', '10.1038/nature00870', '10.9999/not-a-real-doi-xyz'] },
  get_journal_profile: { journal: '0028-0836' },
};
