import { useMemo, useState } from 'react';
import { z } from 'zod';
import {
  PaperSchema,
  trimDebate,
  trimDuplication,
  trimImpact,
  trimSaturation,
} from '@/core/topicCheck/evidence';
import type { TopicCheck } from '@/core/schemas/topicCheck';
import { useAuth } from '@/shared/auth/authContext';
import { createLabResearchClient, LAB_RESEARCH_URL, LabResearchError } from '@/shared/labResearch';
import type { Props } from './types';

type Kind = TopicCheck['evidence'][number]['kind'];
const metadata = z.object({ query_used: z.string().optional(), broadened_from: z.string().optional() });
export function topicErrorMessage(error: unknown): string {
  if (!(error instanceof LabResearchError)) return 'Không thể chạy công cụ nghiên cứu.';
  switch (error.code) {
    case 'not_configured':
      return 'Máy chủ nghiên cứu của lab chưa được cấu hình.';
    case 'signed_out':
      return 'Đăng nhập tài khoản lab để chạy công cụ.';
    case 'network':
      return 'Không thể kết nối máy chủ nghiên cứu.';
    case 'rate_limited':
      return `Quá nhiều yêu cầu. Thử lại sau ${error.retryAfter ?? 0} giây.`;
    case 'invalid_input':
      return 'Dữ liệu gửi tới công cụ không hợp lệ.';
    case 'upstream':
      return 'Dịch vụ nghiên cứu đang gặp sự cố.';
    case 'failed':
      return 'Không thể chạy công cụ nghiên cứu.';
  }
}
/** The text the literature tools search with: the English keywords when given, else the statement. */
export function topicSearchText(check: TopicCheck): string {
  return check.searchQuery?.trim() || check.statement.trim();
}
export function useTopicTools({ check, change }: Props) {
  const { getIdToken } = useAuth();
  const client = useMemo(
    () => createLabResearchClient({ baseUrl: LAB_RESEARCH_URL, getToken: getIdToken }),
    [getIdToken],
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const query = topicSearchText(check);
  const run = async (kind: Kind) => {
    setRunning(true);
    setError(null);
    try {
      const refs = check.neighbours
        .map((n) => n.ref.trim())
        .filter(Boolean)
        .slice(0, 10);
      const input =
        kind === 'duplication'
          ? { question: query, mode: check.track === 'review' ? 'sr' : 'general', limit: 10 }
          : kind === 'saturation'
            ? { gap_statement: query, window_years: 10 }
            : kind === 'debate'
              ? { topic: query, window_years: 3, limit: 15 }
              : { refs };
      let output: unknown;
      if (kind === 'impact') {
        const papers = [];
        for (const ref of refs) {
          try {
            papers.push({
              ref,
              ok: true,
              paper: PaperSchema.parse(await client.callTool('get_paper', { id: ref })),
            });
          } catch (e) {
            setError(e);
            papers.push({ ref, ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }
        output = { papers };
      } else {
        const tool = {
          duplication: 'run_duplication_test',
          saturation: 'check_gap_saturation',
          debate: 'map_topic_debate',
        }[kind];
        output = await client.callTool(tool, input);
      }
      const meta = metadata.parse(output);
      const base = {
        id: crypto.randomUUID(),
        ranAt: new Date().toISOString(),
        input,
        queryUsed: meta.query_used ?? (kind === 'impact' ? refs.join(', ') : query),
        ...(meta.broadened_from ? { broadenedFrom: meta.broadened_from } : {}),
      };
      const snapshot: TopicCheck['evidence'][number] =
        kind === 'duplication'
          ? { ...base, kind, result: trimDuplication(output) }
          : kind === 'saturation'
            ? { ...base, kind, result: trimSaturation(output) }
            : kind === 'debate'
              ? { ...base, kind, result: trimDebate(output) }
              : { ...base, kind, result: trimImpact(output) };
      change((c) => ({ ...c, evidence: [snapshot, ...c.evidence].slice(0, 20) }));
    } catch (e) {
      setError(e);
    } finally {
      setRunning(false);
    }
  };
  return { run, running, error };
}
