// Drives a real headless Chromium against a local HTTP server.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createCapturer } from '../src/capture.js';

let server, base, capturer;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/page' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    // Title is set by JS to prove we read the *rendered* DOM.
    res.end(`<!doctype html><html><head><title>Static</title>
      <meta name="description" content="Integration page">
      <script>document.title = 'Rendered by JS';</script></head>
      <body style="background:#3b5bdb"><h1>Hi</h1></body></html>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  capturer = createCapturer({ allowPrivateHosts: true });
}, 30_000);

afterAll(async () => {
  await capturer?.close();
  server?.close();
});

describe('capture (real browser)', () => {
  it('follows redirects, reads rendered metadata, and returns a JPEG', async () => {
    const result = await capturer.capture(`${base}/redirect`);
    expect(result.title).toBe('Rendered by JS');
    expect(result.description).toBe('Integration page');
    expect(result.finalUrl).toBe(`${base}/page`);
    expect(result.httpStatus).toBe(200);
    expect(result.screenshot.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  }, 30_000);

  it('refuses localhost when the SSRF guard is on', async () => {
    const guarded = createCapturer();
    await expect(guarded.capture(`${base}/page`)).rejects.toThrow(/non-public/);
    await guarded.close();
  });
});
