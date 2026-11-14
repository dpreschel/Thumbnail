import path from 'node:path';
import { createApp } from './app.js';
import { createStore } from './store.js';
import { createCapturer } from './capture.js';
import { createFallback } from './fallback.js';
import { createSiteCapturer } from './siteCapture.js';
import { parseSizes } from './thumbnails.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const allowPrivateHosts = process.env.ALLOW_PRIVATE_HOSTS === '1';
const useBrowser = process.env.DISABLE_BROWSER !== '1';
const dismiss = process.env.DISMISS_CONSENT !== '0';
const sizes = parseSizes(process.env.THUMBNAIL_SIZES);

const store = createStore(DATA_DIR);
const capturer = createSiteCapturer({
  browser: useBrowser ? createCapturer({ allowPrivateHosts, dismiss }) : null,
  fallback: createFallback({ allowPrivateHosts }),
});

const server = createApp({ store, capturer, sizes }).listen(PORT, HOST, () => {
  console.log(`Site Thumbnailer running at http://${HOST}:${PORT}`);
  console.log(`  data: ${DATA_DIR}  sizes: ${JSON.stringify(sizes)}  browser: ${useBrowser ? 'on' : 'off'}`);
});

const shutdown = async () => {
  server.close();
  await capturer.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
