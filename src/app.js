import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeUrl, UrlError } from './urlGuard.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Build the Express app. Dependencies are injected so tests can fake the browser. */
export function createApp({ store, capturer }) {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/sites', async (req, res) => {
    res.json(await store.list());
  });

  app.post('/api/sites', async (req, res, next) => {
    try {
      const inputUrl = normalizeUrl(req.body?.url);
      const result = await capturer.capture(inputUrl);
      const { record, created } = await store.upsert({
        inputUrl,
        url: result.url,
        finalUrl: result.finalUrl,
        title: result.title,
        description: result.description,
        siteName: result.siteName,
        httpStatus: result.httpStatus,
        screenshot: result.screenshot,
      });
      res.status(created ? 201 : 200).json(record);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/sites/:id', async (req, res) => {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const removed = await store.remove(req.params.id);
    return removed ? res.status(204).end() : res.status(404).json({ error: 'Not found' });
  });

  app.use('/thumbnails', express.static(store.thumbDir, { fallthrough: false, maxAge: '1h' }));
  app.use(express.static(publicDir));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof UrlError) return res.status(400).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    if (err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ error: err.status === 404 ? 'Not found' : 'Bad request' });
    }
    // Playwright navigation errors are the site's fault, not ours -> 502.
    const msg = String(err.message || err);
    if (/net::|Timeout|NS_ERROR|No response/i.test(msg)) {
      return res.status(502).json({ error: `Could not load that site: ${msg.split('\n')[0]}` });
    }
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}
