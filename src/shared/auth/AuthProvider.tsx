import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthContext, type LabUser } from './authContext';
import { firebaseConfig, LAB_DOMAIN, labEmail } from './config';

type AuthModule = typeof import('firebase/auth');
let loading: Promise<{ auth: import('firebase/auth').Auth; module: AuthModule }> | null = null;
/** Firebase Auth is loaded on first use, so the first page stays light. */
function loadAuth() {
  loading ??= Promise.all([import('firebase/app'), import('firebase/auth')]).then(([app, module]) => ({
    auth: module.initializeAuth(app.getApps()[0] ?? app.initializeApp(firebaseConfig), {
      persistence: module.browserLocalPersistence,
      popupRedirectResolver: module.browserPopupRedirectResolver,
    }),
    module,
  }));
  return loading;
}

/**
 * The lab account grants access to original PDFs and shared lab projects.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LabUser | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let unsubscribe = () => {};
    let active = true;
    void loadAuth()
      .then(({ auth, module }) => {
        if (!active) return;
        unsubscribe = module.onAuthStateChanged(auth, (next) => {
          if (next && !labEmail(next.email)) {
            void module.signOut(auth);
            setUser(null);
            setError(`Chỉ tài khoản @${LAB_DOMAIN} mới dùng được kho dữ liệu của lab.`);
          } else {
            setUser(next ? { uid: next.uid, email: next.email ?? '', name: next.displayName } : null);
          }
          setReady(true);
        });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(`Không tải được phần đăng nhập: ${String(cause)}`);
        setReady(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const signIn = useCallback(async () => {
    setError('');
    try {
      const { auth, module } = await loadAuth();
      const provider = new module.GoogleAuthProvider();
      provider.setCustomParameters({ hd: LAB_DOMAIN, prompt: 'select_account' });
      const result = await module.signInWithPopup(auth, provider);
      if (!labEmail(result.user.email)) {
        await module.signOut(auth);
        setError(`Tài khoản ${result.user.email ?? ''} không thuộc @${LAB_DOMAIN}.`);
      }
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      setError(
        code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found'
          ? 'Đăng nhập Google chưa được bật cho PaperLab trong Firebase Console.'
          : `Không đăng nhập được: ${String(cause)}`,
      );
    }
  }, []);
  const signOut = useCallback(async () => {
    const { auth, module } = await loadAuth();
    await module.signOut(auth);
  }, []);
  const getIdToken = useCallback(async (expectedUid?: string) => {
    const { auth } = await loadAuth();
    const current = auth.currentUser;
    return current && (expectedUid === undefined || current.uid === expectedUid)
      ? current.getIdToken()
      : null;
  }, []);
  const value = useMemo(
    () => ({ user, ready, error, signIn, signOut, getIdToken }),
    [user, ready, error, signIn, signOut, getIdToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
