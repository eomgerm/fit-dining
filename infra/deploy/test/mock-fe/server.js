// 시험용 목 FE(infra/deploy/test). Next.js standalone의 `node server.js`를 흉내 낸다(포트 3000).
// 모드(MOCK_MODE): ok, broken(첫 화면이 500), no-config(/config.json에 env가 없다), proxy-fail(엣지를 거치면 첫 화면이 500)
// 정적 자산은 /app/.next/static에서 준다. 풀에 없는 자산을 FE가 대신 응답하는 경로를 시험한다.
const http = require('http');
const fs = require('fs');
const path = require('path');

const SHA = process.env.MOCK_SHA;
const MODE = process.env.MOCK_MODE || 'ok';
const APP_ENV = process.env.APP_ENV || 'dev';
const SHORT = SHA.slice(0, 7);
const STATIC_ROOT = '/app/.next/static';

http
  .createServer((req, res) => {
    const url = req.url.split('?')[0];
    const send = (code, body, type = 'text/plain; charset=utf-8', headers = {}) => {
      res.writeHead(code, { 'Content-Type': type, ...headers });
      res.end(body);
    };
    if (url === '/fe-healthz') return send(200, 'ok');
    if (url === '/config.json') {
      return send(200, MODE === 'no-config' ? '{}' : JSON.stringify({ env: APP_ENV }), 'application/json');
    }
    if (url.startsWith('/_next/static/')) {
      const file = path.join(STATIC_ROOT, url.slice('/_next/static/'.length));
      if (!file.startsWith(STATIC_ROOT)) return send(404, 'not found');
      return fs.readFile(file, (err, data) =>
        err
          ? send(404, 'not found')
          : send(200, data, 'text/javascript', { 'Cache-Control': 'public, max-age=31536000, immutable' }),
      );
    }
    if (url === '/') {
      if (MODE === 'broken') return send(500, 'broken');
      if (MODE === 'proxy-fail' && req.headers['x-forwarded-proto']) return send(500, 'proxy-fail');
      return send(
        200,
        `<!doctype html><html><head><script src="/_next/static/chunks/app-${SHORT}.js"></script><script src="/_next/static/chunks/shared.js"></script></head><body>mock-fe ${SHA} ${APP_ENV}</body></html>`,
        'text/html; charset=utf-8',
        { 'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate' },
      );
    }
    return send(404, 'not found');
  })
  .listen(3000, '0.0.0.0');

process.on('SIGTERM', () => process.exit(0));
