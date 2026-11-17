import { useAdmin } from '@/shared/auth/useAdmin';
import { PageHeader } from '@/shared/ui/PageHeader';
import { Empty, Loading } from '@/shared/ui/StateNote';
import { RequestList } from './RequestList';

/** Admin screen: experiment-fact requests from other systems. Only the lab server decides who may see it. */
export default function RequestsPage() {
  const { admin, checking } = useAdmin();
  if (checking) return <Loading label="Đang kiểm tra quyền quản trị…" />;
  if (!admin)
    return (
      <>
        <PageHeader title="Duyệt yêu cầu" />
        <Empty
          title="Chỉ quản trị viên PaperLab mới xem được trang này"
          hint="Máy chủ lab xác nhận quyền quản trị theo tài khoản lab đang đăng nhập."
        />
      </>
    );
  return <RequestList />;
}
