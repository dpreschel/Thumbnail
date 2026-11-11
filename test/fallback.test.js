import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createFallback, FetchError } from '../src/fallback.js';
import { UrlError } from '../src/urlGuard.js';
import { pngImage } from './helpers.js';

let server, base, png;
beforeAll(async () => {
  png = await pngImage();
  server = http.createServer((req, res) => {
    const html = (body) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); };
    switch (req.url) {
      case '/page':
        return html(`<title>Fallback page</title><meta name="description" content="via fetch">
          <meta property="og:image" content="/share.png">`);
      case '/svg-image':
        return html('<title>S</title><meta property="og:image" content="/evil.svg">');
      case '/broken-image':
        return html('<title>B</title><meta property="og:image" content="/missing.png">');
      case '/share.png':
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(png);
      case '/evil.svg':
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        return res.end('<svg/>');
      case '/redirect':
        res.writeHead(301, { Location: '/page' });
        return res.end();
      case '/loop':
        res.writeHead(302, { Location: '/loop' });
        return res.end();
      case '/to-secret':
        res.writeHead(302, { Location: '/secret' });
        return res.end();
      case '/json':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{}');
      case '/huge':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('x'.repeat(3 * 1024 * 1024));
      default:
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('nope');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server?.close());

const fb = createFallback({ allowPrivateHosts: true });

describe('fallback capture (plain HTTP)', () => {
  it('follows redirects and returns metadata + og:image bytes', async () => {
    const r = await fb.capture(`${base}/redirect`);
    expect(r).toMatchObject({
      title: 'Fallback page', description: 'via fetch', finalUrl: `${base}/page`,
      image: expect.any(Buffer), httpStatus: 200,
    });
    expect(r.image.equals(png)).toBe(true);
  });

  it('ignores SVG and missing preview images instead of failing', async () => {
    expect((await fb.capture(`${base}/svg-image`)).image).toBeNull();
    expect((await fb.capture(`${base}/broken-image`)).image).toBeNull();
  });

  it('rejects non-HTML, oversized pages and redirect loops', async () => {
    await expect(fb.capture(`${base}/json`)).rejects.toThrow(/Expected an HTML page/);
    await expect(fb.capture(`${base}/huge`)).rejects.toThrow(FetchError);
    await expect(fb.capture(`${base}/loop`)).rejects.toThrow(/Too many redirects/);
  });

  it('runs the SSRF guard on every redirect hop', async () => {
    const seen = [];
    const guard = async (u) => {
      seen.push(new URL(u).pathname);
      if (u.endsWith('/secret')) throw new UrlError('Refusing to visit non-public address');
    };
    const guarded = createFallback({ guard });
    await expect(guarded.capture(`${base}/to-secret`)).rejects.toThrow(UrlError);
    expect(seen).toEqual(['/to-secret', '/secret']);
  });

  it('refuses private hosts by default', async () => {
    await expect(createFallback().capture(`${base}/page`)).rejects.toThrow(/non-public/);
  });
});
