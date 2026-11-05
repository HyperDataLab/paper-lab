// Checks that an OpenAI-compatible router accepts browser preflight from the deployed SPA.
// Usage: node scripts/check-router-cors.mjs [baseUrl] [origin]
const base = process.argv[2] ?? 'https://paper-understanding-cors.nguyenquocan1010.workers.dev/v1';
const origin = process.argv[3] ?? 'https://hyperdatalab-paragraph-lab.web.app';

const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
  method: 'OPTIONS',
  headers: {
    Origin: origin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type',
  },
});
const allowOrigin = res.headers.get('access-control-allow-origin');
const allowHeaders = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
const ok =
  res.status >= 200 &&
  res.status < 300 &&
  (allowOrigin === '*' || allowOrigin === origin) &&
  (allowHeaders === '*' || allowHeaders.includes('authorization'));

console.log(`preflight ${res.status} | allow-origin=${allowOrigin} | allow-headers=${allowHeaders || '-'}`);
console.log(ok ? 'OK: browsers can call this router directly.' : 'FAIL: router still rejects browser preflight.');
process.exit(ok ? 0 : 1);
