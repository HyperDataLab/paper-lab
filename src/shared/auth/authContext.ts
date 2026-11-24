import { createContext, useContext } from 'react';

export interface LabUser {
  uid: string;
  email: string;
  name: string | null;
}
export interface AuthValue {
  /**
   * The sign-in in use (ADR 0008): 'firebase' works in lab scope with no ResearchHub project; 'sso' (the default
   * when absent) works in the selected ResearchHub project.
   */
  mode?: 'firebase' | 'sso';
  user: LabUser | null;
  /** False until the saved session has been checked. */
  ready: boolean;
  error: string;
  /** True when a ResearchHub-launched handoff could not provide a usable session. */
  handoffFailed?: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** The active sign-in's token for the lab workers (SSO access token or Firebase ID token), or null. */
  getAccessToken?: () => Promise<string | null>;
  /** The same token as getAccessToken; most worker clients call this one. */
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
