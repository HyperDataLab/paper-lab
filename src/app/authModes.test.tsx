// ADR 0008: the Firebase build signs in with Google and works in lab scope; the SSO build works in a ResearchHub
// project. Both send their own token to the worker, and only the SSO build sends a project id.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { resolveAuthMode } from '@/shared/auth/config';
import { PDF_WORKER_URL, projectScopedUrl } from '@/shared/pdfStore';
import { LAB_SCOPE, projectHeader } from '@/shared/scope';
import { StorageProvider, useHubProjectId } from '@/shared/storage/StorageProvider';
import { App } from './App';

const firebase = vi.hoisted(() => {
  const state = {
    user: null as null | {
      uid: string;
      email: string;
      displayName: string;
      getIdToken: () => Promise<string>;
    },
  };
  const auth = {
    get currentUser() {
      return state.user;
    },
  };
  return { state, auth };
});

vi.mock('@/shared/auth/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/auth/config')>()),
  AUTH_MODE: 'firebase',
}));
// The paper workspace is not under test here, and its devtools import is heavy.
vi.mock('@/modules/paper-import/PaperMapPage', () => ({ default: () => null }));
vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: () => ({}) }));
vi.mock('firebase/auth', () => ({
  initializeAuth: () => firebase.auth,
  browserLocalPersistence: {},
  browserPopupRedirectResolver: {},
  onAuthStateChanged: (_auth: unknown, next: (user: unknown) => void) => {
    next(firebase.state.user);
    return () => {};
  },
  GoogleAuthProvider: class {
    setCustomParameters() {}
  },
  signInWithPopup: vi.fn(async () => ({ user: firebase.state.user })),
  signOut: vi.fn(async () => {}),
}));

const PROJECT_ID = '00000000-0000-4000-8000-000000000101';
const workerCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .map(([input, init]) => ({
      url: String(input instanceof Request ? input.url : input),
      headers: new Headers((init as RequestInit | undefined)?.headers),
    }))
    .filter(({ url }) => url.includes(PDF_WORKER_URL));

afterEach(() => {
  firebase.state.user = null;
  vi.unstubAllGlobals();
});

describe('auth mode selection', () => {
  it('follows VITE_AUTH_MODE, else SSO when an SSO client id is set, else Firebase', () => {
    expect(resolveAuthMode('firebase', 'client')).toBe('firebase');
    expect(resolveAuthMode('sso', '')).toBe('sso');
    expect(resolveAuthMode(undefined, 'client')).toBe('sso');
    expect(resolveAuthMode(undefined, '')).toBe('firebase');
    expect(resolveAuthMode('other', undefined)).toBe('firebase');
  });

  it('sends a project id only for a project scope', () => {
    expect(projectHeader(LAB_SCOPE)).toEqual({});
    expect(projectHeader(null)).toEqual({});
    expect(projectHeader(PROJECT_ID)).toEqual({ 'X-Project-Id': PROJECT_ID });
    expect(projectScopedUrl('https://w.example/v1/me', LAB_SCOPE)).toBe('https://w.example/v1/me');
    expect(projectScopedUrl('https://w.example/v1/me', PROJECT_ID)).toBe(
      `https://w.example/v1/me?projectId=${PROJECT_ID}`,
    );
  });
});

describe('Firebase build (lab scope)', () => {
  it('asks for a Google sign-in, not a ResearchHub project', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { signInWithPopup } = await import('firebase/auth');
    render(
      <MemoryRouter initialEntries={['/?projectId=00000000-0000-4000-8000-000000000101']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Cần đăng nhập tài khoản lab' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập bằng Google' }));
    await waitFor(() => expect(signInWithPopup).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signed in, sends the Firebase ID token and no project id to the worker', async () => {
    firebase.state.user = {
      uid: 'firebase-uid',
      email: 'member@hyperdatalab.org',
      displayName: 'Member',
      getIdToken: async () => 'firebase-id-token',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/v1/me')
        ? Response.json({ email: 'member@hyperdatalab.org', admin: false })
        : Response.json({ items: [], cursor: null }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => expect(workerCalls(fetchMock).some(({ url }) => url.endsWith('/v1/me'))).toBe(true));
    const calls = workerCalls(fetchMock);
    for (const { url, headers } of calls) {
      expect(headers.get('Authorization')).toBe('Bearer firebase-id-token');
      expect(headers.has('X-Project-Id')).toBe(false);
      expect(new URL(url, window.location.origin).searchParams.has('projectId')).toBe(false);
    }
  });
});

describe('SSO build (project scope)', () => {
  it('sends the SSO access token and the selected project id', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        email: 'member@hyperdatalab.org',
        admin: false,
        project: { id: PROJECT_ID, name: 'P' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const value: AuthValue = {
      mode: 'sso',
      user: { uid: 'sso-uid', email: 'member@hyperdatalab.org', name: null },
      ready: true,
      error: '',
      signIn: vi.fn(async () => {}),
      signOut: vi.fn(async () => {}),
      getAccessToken: async () => 'sso-access-token',
      getIdToken: async () => 'sso-access-token',
    };
    function Scope() {
      return <p>scope {useHubProjectId()}</p>;
    }
    render(
      <AuthContext.Provider value={value}>
        <StorageProvider projectId={PROJECT_ID}>
          <Scope />
        </StorageProvider>
      </AuthContext.Provider>,
    );
    expect(await screen.findByText(`scope ${PROJECT_ID}`)).toBeInTheDocument();
    const [me] = workerCalls(fetchMock);
    expect(me?.headers.get('Authorization')).toBe('Bearer sso-access-token');
    expect(me?.headers.get('X-Project-Id')).toBe(PROJECT_ID);
    expect(me?.url).toContain(`projectId=${PROJECT_ID}`);
  });

  it('in Firebase mode the same provider gives the lab scope, whatever project the link names', async () => {
    const fetchMock = vi.fn(async () => Response.json({ email: 'member@hyperdatalab.org', admin: false }));
    vi.stubGlobal('fetch', fetchMock);
    const value: AuthValue = {
      mode: 'firebase',
      user: { uid: 'firebase-uid', email: 'member@hyperdatalab.org', name: null },
      ready: true,
      error: '',
      signIn: vi.fn(async () => {}),
      signOut: vi.fn(async () => {}),
      getAccessToken: async () => 'firebase-id-token',
      getIdToken: async () => 'firebase-id-token',
    };
    function Scope() {
      return <p>scope {useHubProjectId()}</p>;
    }
    render(
      <AuthContext.Provider value={value}>
        <StorageProvider projectId={PROJECT_ID}>
          <Scope />
        </StorageProvider>
      </AuthContext.Provider>,
    );
    expect(await screen.findByText(`scope ${LAB_SCOPE}`)).toBeInTheDocument();
    const [me] = workerCalls(fetchMock);
    expect(me?.headers.get('Authorization')).toBe('Bearer firebase-id-token');
    expect(me?.headers.has('X-Project-Id')).toBe(false);
    expect(me?.url).not.toContain('projectId=');
  });
});
