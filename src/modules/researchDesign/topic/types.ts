import type { TopicCheck } from '@/core/schemas/topicCheck';
export type Props = { check: TopicCheck; change: (fn: (check: TopicCheck) => TopicCheck) => void };
