import path from 'node:path';
import { createApp } from './app.js';
import { createStore } from './store.js';
import { createCapturer } from './capture.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');

const store = createStore(DATA_DIR);
const capturer = createCapturer({ allowPrivateHosts: process.env.ALLOW_PRIVATE_HOSTS === '1' });
const server = createApp({ store, capturer }).listen(PORT, HOST, () => {
  console.log(`Site Thumbnailer running at http://${HOST}:${PORT}  (data: ${DATA_DIR})`);
});

const shutdown = async () => {
  server.close();
  await capturer.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
