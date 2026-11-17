import { useEffect, useState } from 'react';
import { exportPackage } from '@/core/researchDesign/plan/exportPackage';
import type { ExperimentPlan } from '@/core/researchDesign/plan/schema';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { useToast } from '@/shared/ui/toastContext';
import { download } from './download';

export function FrozenVersion({
  plan,
  open,
  published,
  signedIn,
  sending,
  send,
}: {
  plan: ExperimentPlan;
  open: (kind: 'plan' | 'runner', plan: ExperimentPlan) => void;
  /** Whether the lab's server holds this version for SRD. */
  published: boolean;
  signedIn: boolean;
  sending: boolean;
  send: (plan: ExperimentPlan) => void;
}) {
  const toast = useToast();
  const [manifest, setManifest] = useState<Awaited<ReturnType<typeof exportPackage>>['manifest'] | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    void exportPackage(plan)
      .then((file) => {
        if (active) setManifest(file.manifest);
      })
      .catch(() => {
        if (active) setManifest(null);
      });
    return () => {
      active = false;
    };
  }, [plan]);
  return (
    <section>
      <p>
        Phiên bản {plan.planVersion} · {plan.frozenBy} · {new Date(plan.frozenAt).toLocaleString('vi-VN')}{' '}
        <Badge tone={published ? 'success' : 'neutral'}>
          {published ? 'Đã có trên máy chủ lab' : 'Chưa gửi lên máy chủ lab'}
        </Badge>
      </p>
      {plan.deviation && <p>{plan.deviation}</p>}
      {manifest ? (
        manifest.files.map((file) => (
          <p key={file.path}>
            {file.path} · SHA-256: <code>{file.sha256}</code>
          </p>
        ))
      ) : (
        <p>Không tải được mã băm.</p>
      )}
      <Button variant="ghost" onClick={() => open('plan', plan)}>
        Xem
      </Button>
      <Button
        variant="ghost"
        onClick={() =>
          void exportPackage(plan)
            .then((file) => download(file.fileName, file.bytes, 'application/zip'))
            .catch(() => toast('Không tải được gói.'))
        }
      >
        Tải gói (.zip)
      </Button>
      <Button variant="ghost" onClick={() => open('runner', plan)}>
        Mã mẫu cho runner
      </Button>
      {!published && (
        <Button variant="ghost" disabled={!signedIn || sending} onClick={() => send(plan)}>
          {sending ? 'Đang gửi…' : 'Gửi lên máy chủ lab'}
        </Button>
      )}
    </section>
  );
}
