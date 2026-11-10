import { createRemoteJWKSet } from 'jose';
import { handle, type Bucket } from './app';
import { SECURETOKEN_JWKS, verifyFirebaseToken } from './auth';

interface Env {
  BUCKET: Bucket;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_DOMAIN: string;
  ALLOWED_ORIGINS: string;
}

const jwks = createRemoteJWKSet(new URL(SECURETOKEN_JWKS));

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(
      {
        verifyToken: (token) => verifyFirebaseToken(token, jwks, env.FIREBASE_PROJECT_ID, env.ALLOWED_DOMAIN),
        bucket: env.BUCKET,
        allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()),
        now: () => new Date(),
      },
      request,
    );
  },
};
