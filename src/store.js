// Dead-simple persistence: one JSON file for records + a folder of JPEGs.
// Good enough for a POC; swap for a real DB/object store later.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const SIZE_NAME = /^[a-z][a-z0-9]{0,15}$/;

export function createStore(dataDir) {
  const file = path.join(dataDir, 'sites.json');
  const thumbDir = path.join(dataDir, 'thumbnails');
  let cache = null;
  let queue = Promise.resolve(); // serialize writes so concurrent requests can't clobber each other

  async function load() {
    if (cache) return cache;
    await fs.mkdir(thumbDir, { recursive: true });
    try {
      cache = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!Array.isArray(cache)) cache = [];
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      cache = [];
    }
    return cache;
  }

  async function persist() {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(cache, null, 2));
    await fs.rename(tmp, file); // atomic replace
  }

  const exclusive = (fn) => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  async function removeThumbs(id) {
    const files = await fs.readdir(thumbDir).catch(() => []);
    await Promise.all(
      files.filter((f) => f.startsWith(`${id}`)).map((f) => fs.rm(path.join(thumbDir, f), { force: true })),
    );
  }

  return {
    thumbDir,

    async list() {
      const sites = await load();
      return [...sites].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    },

    async get(id) {
      return (await load()).find((s) => s.id === id) ?? null;
    },

    /**
     * Insert, or update the existing record with the same canonical URL.
     * @param {object} input  record fields plus `images`: { sizeName: Buffer } or null
     */
    upsert({ images, ...fields }) {
      return exclusive(async () => {
        const sites = await load();
        const existing = sites.find((s) => s.url === fields.url);
        const id = existing?.id ?? crypto.randomUUID();

        await removeThumbs(id); // sizes may have changed, or this capture has no image
        let thumbnails = null;
        if (images && Object.keys(images).length) {
          thumbnails = {};
          for (const [size, buf] of Object.entries(images)) {
            if (!SIZE_NAME.test(size)) throw new Error(`Bad thumbnail size name "${size}"`);
            await fs.writeFile(path.join(thumbDir, `${id}-${size}.jpg`), buf);
            thumbnails[size] = `/thumbnails/${id}-${size}.jpg`;
          }
        }

        const { thumbnail: _legacy, ...prev } = existing ?? {};
        const record = { ...prev, ...fields, id, thumbnails, capturedAt: new Date().toISOString() };
        if (existing) sites[sites.indexOf(existing)] = record;
        else sites.push(record);
        await persist();
        return { record, created: !existing };
      });
    },

    remove(id) {
      return exclusive(async () => {
        const sites = await load();
        const idx = sites.findIndex((s) => s.id === id);
        if (idx === -1) return false;
        sites.splice(idx, 1);
        await persist();
        await removeThumbs(id);
        return true;
      });
    },
  };
}
