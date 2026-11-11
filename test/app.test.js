import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createStore } from '../src/store.js';
import { UrlError } from '../src/urlGuard.js';
import { pngImage } from './helpers.js';

const sizes = { small: 160, medium: 320 };
const logger = { warn: vi.fn(), error: vi.fn() };
let dir, app, capturer, png;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-app-'));
  png = await pngImage(640, 400);
  capturer = {
    capture: vi.fn(async (url) => ({
      title: 'Example', description: 'Desc', url, finalUrl: url, siteName: null,
      httpStatus: 200, image: png, captureMode: 'browser', fallbackReason: null,
    })),
  };
  app = createApp({ store: createStore(dir), capturer, sizes, logger });
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('API', () => {
  it('captures a site, lists it, serves every thumbnail size, and deletes it', async () => {
    const created = await request(app).post('/api/sites').send({ url: 'example.com' }).expect(201);
    expect(capturer.capture).toHaveBeenCalledWith('https://example.com/');
    expect(created.body).toMatchObject({
      title: 'Example', description: 'Desc', url: 'https://example.com/', captureMode: 'browser',
    });
    expect(Object.keys(created.body.thumbnails)).toEqual(['small', 'medium']);

    for (const [name, width] of Object.entries(sizes)) {
      const img = await request(app).get(created.body.thumbnails[name]).buffer(true).expect(200);
      expect(img.headers['content-type']).toMatch(/jpeg/);
      expect((await sharp(img.body).metadata()).width).toBe(width);
    }

    expect((await request(app).get('/api/sites').expect(200)).body).toHaveLength(1);

    await request(app).delete(`/api/sites/${created.body.id}`).expect(204);
    await request(app).get(created.body.thumbnails.small).expect(404);
    expect((await request(app).get('/api/sites')).body).toEqual([]);
  });

  it('exposes the configured sizes', async () => {
    expect((await request(app).get('/api/config').expect(200)).body).toEqual({ thumbnailSizes: sizes });
  });

  it('records fallback captures with no image', async () => {
    capturer.capture.mockResolvedValueOnce({
      title: 'Basic', url: 'https://b.test/', finalUrl: 'https://b.test/', image: null,
      captureMode: 'fallback', fallbackReason: 'Timeout',
    });
    const res = await request(app).post('/api/sites').send({ url: 'b.test' }).expect(201);
    expect(res.body).toMatchObject({ captureMode: 'fallback', fallbackReason: 'Timeout', thumbnails: null });
  });

  it('keeps the metadata when the image is corrupt', async () => {
    capturer.capture.mockResolvedValueOnce({
      title: 'Bad img', url: 'https://c.test/', finalUrl: 'https://c.test/', image: Buffer.from('nope'),
    });
    const res = await request(app).post('/api/sites').send({ url: 'c.test' }).expect(201);
    expect(res.body).toMatchObject({ title: 'Bad img', thumbnails: null });
    expect(logger.warn).toHaveBeenCalled();
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

  it('maps SSRF refusals to 400 and load failures to 502', async () => {
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

  it('serves the UI with security headers, plus a health check', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.text).toContain('Site Thumbnailer');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
    await request(app).get('/healthz').expect(200, { ok: true });
  });
});
