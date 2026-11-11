import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createStore } from '../src/store.js';
import { UrlError } from '../src/urlGuard.js';

let dir, app, capturer;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-app-'));
  capturer = {
    capture: vi.fn(async (url) => ({
      title: 'Example', description: 'Desc', url, finalUrl: url, siteName: null,
      httpStatus: 200, screenshot: Buffer.from([0xff, 0xd8, 0xff]),
    })),
  };
  app = createApp({ store: createStore(dir), capturer });
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('API', () => {
  it('captures a site, lists it, serves its thumbnail, and deletes it', async () => {
    const created = await request(app).post('/api/sites').send({ url: 'example.com' }).expect(201);
    expect(capturer.capture).toHaveBeenCalledWith('https://example.com/');
    expect(created.body).toMatchObject({ title: 'Example', description: 'Desc', url: 'https://example.com/' });

    const list = await request(app).get('/api/sites').expect(200);
    expect(list.body).toHaveLength(1);

    const img = await request(app).get(created.body.thumbnail).expect(200);
    expect(img.headers['content-type']).toMatch(/jpeg/);

    await request(app).delete(`/api/sites/${created.body.id}`).expect(204);
    await request(app).get(created.body.thumbnail).expect(404);
    expect((await request(app).get('/api/sites')).body).toEqual([]);
  });

  it('returns 200 (not 201) when re-capturing an existing URL', async () => {
    await request(app).post('/api/sites').send({ url: 'example.com' }).expect(201);
    await request(app).post('/api/sites').send({ url: 'https://example.com' }).expect(200);
  });

  it('rejects bad input with 400 and never launches the browser', async () => {
    const res = await request(app).post('/api/sites').send({ url: 'ftp://x.com' }).expect(400);
    expect(res.body.error).toMatch(/http and https/);
    await request(app).post('/api/sites').send({}).expect(400);
    await request(app).post('/api/sites').set('Content-Type', 'application/json').send('{bad').expect(400);
    expect(capturer.capture).not.toHaveBeenCalled();
  });

  it('maps SSRF refusals to 400 and navigation failures to 502', async () => {
    capturer.capture.mockRejectedValueOnce(new UrlError('Refusing to visit non-public address'));
    await request(app).post('/api/sites').send({ url: 'internal.test' }).expect(400);
    capturer.capture.mockRejectedValueOnce(new Error('page.goto: net::ERR_NAME_NOT_RESOLVED'));
    const res = await request(app).post('/api/sites').send({ url: 'nope.test' }).expect(502);
    expect(res.body.error).toMatch(/ERR_NAME_NOT_RESOLVED/);
  });

  it('404s unknown ids and blocks path traversal on thumbnails', async () => {
    await request(app).delete('/api/sites/not-a-uuid').expect(404);
    await request(app).delete('/api/sites/00000000-0000-0000-0000-000000000000').expect(404);
    const res = await request(app).get('/thumbnails/..%2Fsites.json');
    expect([403, 404]).toContain(res.status);
    expect(res.text).not.toContain('"url"');
  });

  it('serves the UI with security headers', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.text).toContain('Site Thumbnailer');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
