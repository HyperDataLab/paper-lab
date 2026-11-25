// The PaperLab SPA always signs in through SSO; the Worker keeps Firebase compatibility for lab integrations.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '@/shared/auth/authContext';
import { resolveAuthMode } from '@/shared/auth/config';
import { PDF_WORKER_URL, projectScopedUrl } from '@/shared/pdfStore';
import { LAB_SCOPE, projectHeader } from '@/shared/scope';
import { StorageProvider, useHubProjectId } from '@/shared/storage/StorageProvider';
import { App } from './App';

// The paper workspace is not under test here, and its devtools import is heavy.
vi.mock('@/modules/paper-import/PaperMapPage', () => ({ default: () => null }));

const PROJECT_ID = '00000000-0000-4000-8000-000000000101';
const workerCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .map(([input, init]) => ({
      url: String(input instanceof Request ? input.url : input),
      headers: new Headers((init as RequestInit | undefined)?.headers),
    }))
    .filter(({ url }) => url.includes(PDF_WORKER_URL));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auth mode selection', () => {
  it('always uses SSO regardless of environment and legacy mode values', () => {
    expect(resolveAuthMode('firebase', 'client')).toBe('sso');
    expect(resolveAuthMode('sso', '')).toBe('sso');
    expect(resolveAuthMode(undefined, 'client')).toBe('sso');
    expect(resolveAuthMode(undefined, '')).toBe('sso');
    expect(resolveAuthMode('other', undefined)).toBe('sso');
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

describe('PaperLab SSO entry', () => {
  it('asks for SSO on a standalone route instead of falling back to Google sign-in', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Đăng nhập vào PaperLab' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng nhập SSO' })).toBeInTheDocument();
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
