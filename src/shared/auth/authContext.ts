import { createContext, useContext } from 'react';

export interface LabUser {
  uid: string;
  email: string;
  name: string | null;
}
export interface AuthValue {
  user: LabUser | null;
  /** False until the saved session has been checked. */
  ready: boolean;
  error: string;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** A fresh ID token for the lab's services, or null when nobody is signed in. */
  getIdToken: (expectedUid?: string) => Promise<string | null>;
}

const signedOut: AuthValue = {
  user: null,
  ready: true,
  error: '',
  signIn: async () => {},
  signOut: async () => {},
  getIdToken: async () => null,
};
/** Screens rendered on their own have no lab session. */
export const AuthContext = createContext<AuthValue>(signedOut);
export const useAuth = () => useContext(AuthContext);
