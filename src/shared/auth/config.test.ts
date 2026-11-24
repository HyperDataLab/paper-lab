import { expect, it } from 'vitest';
import { ssoConfigurationError } from './config';

it('names the missing SSO setting instead of showing a generic configuration failure', () => {
  expect(
    ssoConfigurationError({
      baseUrl: 'https://sso.test',
      clientId: '',
      callbackUrl: 'http://localhost/callback',
    }),
  ).toContain('VITE_HYPERDATALAB_SSO_CLIENT_ID');
  expect(
    ssoConfigurationError({
      baseUrl: 'https://sso.test',
      clientId: 'paperlab-client',
      callbackUrl: 'http://localhost/callback',
    }),
  ).toBe('');
});
