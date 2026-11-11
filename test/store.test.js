import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';

let dir;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-store-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const site = (url, extra = {}) => ({ url, title: 'T', screenshot: Buffer.from('jpg'), ...extra });

describe('store', () => {
  it('starts empty and persists records + thumbnails to disk', async () => {
    const store = createStore(dir);
    expect(await store.list()).toEqual([]);
    const { record, created } = await store.upsert(site('https://a.test/'));
    expect(created).toBe(true);
    expect(record.thumbnail).toBe(`/thumbnails/${record.id}.jpg`);
    expect(await fs.readFile(path.join(dir, 'thumbnails', `${record.id}.jpg`), 'utf8')).toBe('jpg');

    const reopened = createStore(dir);
    expect(await reopened.get(record.id)).toMatchObject({ url: 'https://a.test/', title: 'T' });
  });

  it('updates in place when the same canonical URL is captured again', async () => {
    const store = createStore(dir);
    const first = await store.upsert(site('https://a.test/'));
    const second = await store.upsert(site('https://a.test/', { title: 'New' }));
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(await store.list()).toHaveLength(1);
    expect((await store.list())[0].title).toBe('New');
  });

  it('handles concurrent writes without losing records', async () => {
    const store = createStore(dir);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.upsert(site(`https://s${i}.test/`))));
    expect(await createStore(dir).list()).toHaveLength(20);
  });

  it('removes records and their thumbnails', async () => {
    const store = createStore(dir);
    const { record } = await store.upsert(site('https://a.test/'));
    expect(await store.remove(record.id)).toBe(true);
    expect(await store.remove(record.id)).toBe(false);
    expect(await store.list()).toEqual([]);
    await expect(fs.access(path.join(dir, 'thumbnails', `${record.id}.jpg`))).rejects.toThrow();
  });
});
