import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Target } from '@/core/researchDesign/suggest/suggest';
import { hasValidConsent } from '@/shared/llm';
import { useLlm } from '@/shared/llm/LlmProvider';
import { Button } from '@/shared/ui/Button';
import { factsDocs } from './factsDocs';
import { SuggestDrawer } from './SuggestDrawer';
import type { Loaded } from './useEvidence';

export function SectionSuggest({ state, target }: { state: Loaded; target: Target }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const llm = useLlm();
  const papers = state.papers.papers.filter((paper) => paper.decision === 'included');
  const docs = factsDocs(state.design, state.facts);
  const hasFacts = papers.some((paper) => {
    const doc = docs[paper.id];
    return doc?.facts.facts.some((fact) => doc.decisions[fact.id]?.decision === 'use');
  });
  const reason = !hasFacts
    ? 'Chọn dữ kiện Dùng trong Bảng so sánh trước.'
    : !llm.config.model.trim()
      ? 'Chọn model trong Cài đặt trước.'
      : !hasValidConsent(llm.config)
        ? 'Kiểm tra kết nối trong Cài đặt để đồng ý gửi dữ liệu cho AI.'
        : '';
  return (
    <>
      <Button disabled={!!reason} onClick={() => setOpen(true)}>
        Gợi ý từ bảng so sánh
      </Button>
      {reason && <p>{reason}</p>}
      {open && (
        <SuggestDrawer
          state={state}
          papers={papers}
          docs={docs}
          scope={target}
          close={() => setOpen(false)}
          openFacts={() => navigate('?design=evidence')}
        />
      )}
    </>
  );
}
