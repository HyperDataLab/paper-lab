import type { ReactNode } from 'react';
import { useAuth } from '@/shared/auth/authContext';
import { Card } from '@/shared/ui/Card';
import { Loading } from '@/shared/ui/StateNote';
import { AccountButton } from './AccountButton';

export function LabDataGate({ children }: { children: ReactNode }) {
  const { user, ready, error } = useAuth();
  if (!ready) return <Loading label="Đang kiểm tra tài khoản lab…" />;
  if (user) return children;
  return (
    <Card>
      <h1>Cần đăng nhập lab</h1>
      <p>Đăng nhập bằng tài khoản lab để xem và lưu dữ liệu PaperLab.</p>
      <AccountButton />
      {error && <p role="alert">{error}</p>}
    </Card>
  );
}
