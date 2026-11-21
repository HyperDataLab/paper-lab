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
  /** True when a ResearchHub-launched handoff could not provide a usable session. */
  handoffFailed?: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** A valid HyperDataLab SSO access token, or null when signed out/expired. */
  getAccessToken?: () => Promise<string | null>;
  /** @deprecated Use getAccessToken; retained while existing paper features migrate. */
  getIdToken: () => Promise<string | null>;
}

const signedOut: AuthValue = {
  user: null,
  ready: true,
  error: '',
  handoffFailed: false,
  signIn: async () => {},
  signOut: async () => {},
  getAccessToken: async () => null,
  getIdToken: async () => null,
};
/** Without a provider (pages rendered on their own, tests) nobody is signed in and nothing leaves the machine. */
export const AuthContext = createContext<AuthValue>(signedOut);
export const useAuth = () => useContext(AuthContext);
