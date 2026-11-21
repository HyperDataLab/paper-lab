import { planMarkdown } from '@/core/researchDesign/plan/planMarkdown';
import { runnerStubs } from '@/core/researchDesign/plan/runnerStubs';
import type { ExperimentPlan } from '@/core/researchDesign/plan/schema';
import { Button } from '@/shared/ui/Button';
import { Drawer } from '@/shared/ui/Drawer';
import { useToast } from '@/shared/ui/toastContext';
import { Markdown } from './Markdown';
import { download } from './download';

export type PlanPreview = { kind: 'plan' | 'runner'; plan: ExperimentPlan };

export function PlanPreviewDrawer({ preview, close }: { preview: PlanPreview; close: () => void }) {
  const toast = useToast();
  const { kind, plan } = preview;
  return (
    <Drawer
      open
      side="right"
      title={kind === 'plan' ? `Phiên bản ${plan.planVersion} · đã đóng băng · chỉ đọc` : 'Mã mẫu cho runner'}
      onClose={close}
    >
      {kind === 'plan' ? (
        <Markdown text={planMarkdown(plan)} />
      ) : (
        <>
          <p>Điểm bắt đầu cho mã chạy; ứng dụng này không chạy chúng.</p>
          {Object.values(runnerStubs(plan))
            .filter((x): x is { fileName: string; text: string } => typeof x !== 'number')
            .map((file) => (
              <section key={file.fileName}>
                <h3>{file.fileName}</h3>
                <pre>{file.text}</pre>
                <Button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(file.text)
                      .then(() => toast('Đã sao chép.'))
                      .catch(() => toast('Không sao chép được.'))
                  }
                >
                  Sao chép
                </Button>
                <Button
                  onClick={() => download(file.fileName, new TextEncoder().encode(file.text), 'text/plain')}
                >
                  Tải về
                </Button>
              </section>
            ))}
        </>
      )}
    </Drawer>
  );
}
