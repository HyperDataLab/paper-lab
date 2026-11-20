import { useAuth } from '@/shared/auth/authContext';
import { LAB_DOMAIN } from '@/shared/auth/config';
import { useAdmin } from '@/shared/auth/useAdmin';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { LegacyCorporaImport } from './LegacyCorporaImport';
import styles from './page.module.css';

/** The account that grants access to the lab's shared storage. */
export function LabAccountCard() {
  const { user, ready, error, signIn, signOut } = useAuth();
  const { admin } = useAdmin();
  return (
    <Card>
      <div className={styles.section}>
        <header>
          <h2>Tài khoản lab</h2>
          <p>
            Đăng nhập bằng tài khoản Google @{LAB_DOMAIN} để dùng PDF gốc, dự án trích xuất, thiết kế nghiên
            cứu và lượt chạy AutoResearch trong kho chung của lab. Khi đăng xuất, ứng dụng dùng dữ liệu trên
            thiết bị này.
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
        {admin && user && <LegacyCorporaImport key={user.uid} uid={user.uid} />}
      </div>
    </Card>
  );
}
