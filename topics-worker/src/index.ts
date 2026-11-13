import { Container, getContainer } from '@cloudflare/containers';
import { createRemoteJWKSet } from 'jose';
import { handle, type Bucket } from './app';
import { SECURETOKEN_JWKS, verifyFirebaseToken } from './auth';

export class TopicsContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '15m';
  enableInternet = true;
}
interface Env {
  BUCKET: Bucket;
  TOPICS: Parameters<typeof getContainer>[0];
  FIREBASE_PROJECT_ID: string;
  ALLOWED_DOMAIN: string;
  ALLOWED_ORIGINS: string;
}
const jwks = createRemoteJWKSet(new URL(SECURETOKEN_JWKS));
export default {
  fetch(request: Request, env: Env) {
    return handle(request, {
      bucket: env.BUCKET,
      origins: env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()),
      verify: (token) => verifyFirebaseToken(token, jwks, env.FIREBASE_PROJECT_ID, env.ALLOWED_DOMAIN),
      container: (path, init) => getContainer(env.TOPICS).fetch(`http://container${path}`, init),
    });
  },
};
