import { useAuth } from '@/shared/auth/authContext';
import { LAB_DOMAIN } from '@/shared/auth/config';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import styles from './page.module.css';

/** Who is signed in to the lab, and what that changes: only where original PDFs are kept. */
export function LabAccountCard() {
  const { user, ready, error, signIn, signOut } = useAuth();
  return (
    <Card>
      <div className={styles.section}>
        <header>
          <h2>Tài khoản lab</h2>
          <p>
            Đăng nhập bằng tài khoản Google @{LAB_DOMAIN} để lưu PDF gốc của bài vào kho chung của lab và mở
            được trên máy khác. Thành viên lab đã đăng nhập đều mở được các PDF trong kho. Không đăng nhập thì
            PDF chỉ nằm trên máy này; mọi phân tích vẫn chạy như bình thường.
          </p>
        </header>
        <div className={styles.fields}>
          <div className={styles.statusRow}>
            {!ready ? (
              <Badge>Đang kiểm tra…</Badge>
            ) : user ? (
              <>
                <Badge tone="success">Đã đăng nhập</Badge>
                <span>{user.email}</span>
              </>
            ) : (
              <Badge>Chưa đăng nhập</Badge>
            )}
          </div>
          <div className={styles.start}>
            {user ? (
              <Button onClick={() => void signOut()}>Đăng xuất</Button>
            ) : (
              <Button variant="primary" disabled={!ready} onClick={() => void signIn()}>
                Đăng nhập bằng Google
              </Button>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
    </Card>
  );
}
