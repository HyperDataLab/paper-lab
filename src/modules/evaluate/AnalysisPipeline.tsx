import { CheckCircle2, Info, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/shared/ui/Button';
import { AnalysisStep, type StepState } from './AnalysisStep';
import { SyntaxControls } from './SyntaxControls';
import type { SyntaxAnalysis } from './useSyntaxAnalysis';
import type { useCandidateJudge } from './useCandidateJudge';
import type { useParagraphAnalysis } from './useParagraphAnalysis';
import type { useScoring } from './useScoring';
import styles from './steps.module.css';

const number = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
function Done({ children }: { children: string }) {
  return (
    <span className={styles.done}>
      <CheckCircle2 size={14} aria-hidden="true" />
      {children}
    </span>
  );
}

/** The four analysis stages of an unsaved paragraph, in order, with the next one highlighted. */
export function AnalysisPipeline({
  syntax,
  paragraph,
  judge,
  scoring,
  canJudge,
  judgeDone,
  nextStep,
  saved,
  saving,
  contextLimited,
  onSyntax,
  onStructure,
  onJudge,
  onScore,
}: {
  syntax: SyntaxAnalysis;
  paragraph: ReturnType<typeof useParagraphAnalysis>;
  judge: ReturnType<typeof useCandidateJudge>;
  scoring: ReturnType<typeof useScoring>;
  canJudge: boolean;
  judgeDone: boolean;
  nextStep: string;
  saved: boolean;
  saving: boolean;
  contextLimited: boolean;
  onSyntax: () => void;
  onStructure: () => void;
  onJudge: () => void;
  onScore: () => void;
}) {
  const state = (running: boolean, done: boolean, id: string, blocked = false): StepState =>
    running ? 'running' : done ? 'done' : blocked ? 'blocked' : nextStep === id ? 'next' : 'idle';
  const states = [
    state(syntax.running, !!syntax.annotations, 'syntax'),
    state(paragraph.running, !!paragraph.result, 'structure', !syntax.annotations),
    state(judge.running, judgeDone, 'judge', !canJudge),
    state(scoring.running, !!scoring.result, 'score'),
  ];
  const finished = states.filter((value) => value === 'done').length;
  const busy = syntax.running || judge.running || paragraph.running || scoring.running;
  const overall = scoring.result?.scores.overall;
  return (
    <section className={styles.pipeline} aria-labelledby="pipeline-title">
      <div className={styles.head}>
        <h2 id="pipeline-title">Các bước phân tích</h2>
        <span className={styles.progress}>{finished}/4 bước xong</span>
      </div>
      <ol className={styles.steps}>
        <AnalysisStep
          number={1}
          state={states[0] ?? 'idle'}
          title="Ngữ pháp từng câu"
          detail={
            syntax.annotations ? (
              <Done>{`Xong · ${syntax.annotations.length} câu`}</Done>
            ) : (
              'Chủ ngữ, động từ chính, Topic, Action và Stress.'
            )
          }
        >
          <SyntaxControls
            syntax={syntax}
            readOnly={false}
            saved={saved}
            busy={judge.running || paragraph.running || scoring.running}
            onRun={onSyntax}
          />
        </AnalysisStep>
        <AnalysisStep
          number={2}
          state={states[1] ?? 'idle'}
          title="Cấu trúc paragraph"
          detail={
            paragraph.result ? (
              <Done>{`Xong · kiểu ${paragraph.result.paragraph.type === 'UNKNOWN' ? 'chưa rõ' : paragraph.result.paragraph.type}`}</Done>
            ) : !syntax.annotations ? (
              <span>Cần phân tích câu trước</span>
            ) : (
              'Kiểu paragraph, ý chính, vai trò từng câu và mạch nối.'
            )
          }
        >
          {paragraph.running ? (
            <>
              <span role="status">Đang phân tích cấu trúc…</span>
              <Button size="sm" variant="danger" onClick={paragraph.cancel}>
                Huỷ
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant={nextStep === 'structure' ? 'primary' : 'secondary'}
              disabled={saved || !syntax.annotations || syntax.running || judge.running || scoring.running}
              onClick={onStructure}
            >
              Phân tích cấu trúc paragraph (AI)
            </Button>
          )}
          {paragraph.error && <p role="alert">Không phân tích được: {paragraph.error}</p>}
        </AnalysisStep>
        <AnalysisStep
          number={3}
          state={states[2] ?? 'idle'}
          title="Đánh giá theo ngữ cảnh"
          detail={
            !canJudge ? (
              'Chưa có ứng viên để đánh giá.'
            ) : judgeDone ? (
              <Done>Xong · AI đã xét từng gợi ý</Done>
            ) : (
              'AI xét lại từng gợi ý trong ngữ cảnh của đoạn.'
            )
          }
        >
          {canJudge &&
            (judge.running ? (
              <>
                <span role="status">Đang đánh giá…</span>
                <Button size="sm" variant="danger" onClick={judge.cancel}>
                  Huỷ
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant={nextStep === 'judge' ? 'primary' : 'secondary'}
                disabled={saved || syntax.running || paragraph.running || scoring.running}
                onClick={onJudge}
              >
                Đánh giá theo ngữ cảnh (AI)
              </Button>
            ))}
          {judge.error && (
            <p role="alert">
              Không đánh giá được: {judge.error}{' '}
              {judge.error.includes('Chưa nhập khoá API') && <Link to="/settings">Cài đặt</Link>}
            </p>
          )}
        </AnalysisStep>
        <AnalysisStep
          number={4}
          state={states[3] ?? 'idle'}
          title="Chấm điểm"
          detail={
            scoring.result ? (
              <Done>
                {overall === null || overall === undefined
                  ? 'Xong · chưa tính điểm tổng'
                  : `Xong · ${number(overall)}/100`}
              </Done>
            ) : (
              'Năm tiêu chí theo rubric, thang 0–100.'
            )
          }
        >
          {scoring.running ? (
            <>
              <span role="status">Đang chấm điểm…</span>
              <Button size="sm" variant="danger" onClick={scoring.cancel}>
                Huỷ
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant={nextStep === 'score' ? 'primary' : 'secondary'}
              disabled={saved || saving || (busy && !scoring.running)}
              onClick={onScore}
            >
              Chấm điểm (AI)
            </Button>
          )}
          {scoring.error && <p role="alert">Không chấm điểm được: {scoring.error}</p>}
        </AnalysisStep>
      </ol>
      <div className={styles.foot}>
        <span>
          <Info size={14} aria-hidden="true" />
          {contextLimited
            ? 'Chỉ phân tích riêng đoạn này, không có ngữ cảnh của đoạn trước và sau.'
            : 'Đã xét cùng đoạn trước và đoạn sau.'}
        </span>
        {saved && (
          <span>
            <Lock size={14} aria-hidden="true" />
            Đã lưu — chọn Chỉnh sửa văn bản để phân tích lại
          </span>
        )}
      </div>
    </section>
  );
}
