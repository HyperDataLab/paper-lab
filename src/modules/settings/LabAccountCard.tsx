import { useAuth } from '@/shared/auth/authContext';
import { LAB_DOMAIN } from '@/shared/auth/config';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import styles from './page.module.css';

/** Shows the central SSO identity used for project and PDF access. */
export function LabAccountCard() {
  const { user, ready, error, signIn, signOut } = useAuth();
  return (
    <Card>
      <div className={styles.section}>
        <header>
          <h2>Tài khoản ResearchHub</h2>
          <p>
            Đăng nhập bằng HyperDataLab SSO với email đã xác minh thuộc @{LAB_DOMAIN}. Workspace mở từ
            ResearchHub được lưu chung trên server theo project; bản PDF gốc được lưu trong kho dùng chung của
            lab.
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
                Đăng nhập bằng HyperDataLab SSO
              </Button>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
    </Card>
  );
}
