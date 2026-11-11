import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';

let dir;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-store-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const images = { small: Buffer.from('s'), large: Buffer.from('L') };
const site = (url, extra = {}) => ({ url, title: 'T', images, ...extra });
const thumbFiles = () => fs.readdir(path.join(dir, 'thumbnails'));

describe('store', () => {
  it('starts empty and persists records + one file per thumbnail size', async () => {
    const store = createStore(dir);
    expect(await store.list()).toEqual([]);
    const { record, created } = await store.upsert(site('https://a.test/'));
    expect(created).toBe(true);
    expect(record.thumbnails).toEqual({
      small: `/thumbnails/${record.id}-small.jpg`,
      large: `/thumbnails/${record.id}-large.jpg`,
    });
    expect(await fs.readFile(path.join(dir, 'thumbnails', `${record.id}-large.jpg`), 'utf8')).toBe('L');

    const reopened = createStore(dir);
    expect(await reopened.get(record.id)).toMatchObject({ url: 'https://a.test/', title: 'T' });
  });

  it('updates in place on re-capture and drops stale thumbnail files', async () => {
    const store = createStore(dir);
    const first = await store.upsert(site('https://a.test/'));
    const second = await store.upsert(site('https://a.test/', { title: 'New', images: { medium: Buffer.from('m') } }));
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(await store.list()).toHaveLength(1);
    expect((await store.list())[0].title).toBe('New');
    expect(await thumbFiles()).toEqual([`${first.record.id}-medium.jpg`]);
  });

  it('stores records with no image (fallback capture) as thumbnails: null', async () => {
    const store = createStore(dir);
    const { record } = await store.upsert(site('https://a.test/', { images: null }));
    expect(record.thumbnails).toBeNull();
    expect(await thumbFiles()).toEqual([]);
  });

  it('rejects unsafe size names', async () => {
    await expect(createStore(dir).upsert(site('https://a.test/', { images: { '../x': Buffer.from('') } })))
      .rejects.toThrow(/size name/);
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
    expect(await thumbFiles()).toEqual([]);
  });
});
