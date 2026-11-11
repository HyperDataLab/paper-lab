import { LogIn, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/shared/auth/authContext';
import { Button } from '@/shared/ui/Button';
import styles from './shell.module.css';

/** The lab account in the top bar: who is signed in, or one button to sign in. Details live in Settings. */
export function AccountButton() {
  const { user, ready, signIn } = useAuth();
  if (!ready) return null;
  if (!user)
    return (
      <Button variant="ghost" size="sm" onClick={() => void signIn()}>
        <LogIn size={16} aria-hidden="true" /> Đăng nhập lab
      </Button>
    );
  return (
    <Link to="/settings" className={styles.account} title={`${user.email} · Tài khoản lab`}>
      <UserRound size={16} aria-hidden="true" />
      <span>{user.name ?? user.email}</span>
    </Link>
  );
}
