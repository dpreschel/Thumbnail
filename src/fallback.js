// Metadata-only fallback for when the headless browser can't do the job
// (bot walls that kill Chromium, timeouts, crashes, Chromium not installed...).
// Plain HTTP fetch of the HTML, plus the site's og:image as a stand-in thumbnail.
import { assertPublicUrl } from './urlGuard.js';
import { extractMetadata } from './metadata.js';

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|avif)\b/i; // no SVG: scriptable, and sharp would render it
const USER_AGENT = 'Mozilla/5.0 (compatible; SiteThumbnailer/0.2; +metadata-preview)';

export class FetchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FetchError';
  }
}

async function readCapped(res, max) {
  const len = Number(res.headers.get('content-length'));
  if (len > max) throw new FetchError(`Response too large (${len} bytes).`);
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > max) throw new FetchError('Response too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** fetch() that follows redirects by hand so every hop goes through the SSRF guard. */
export async function guardedFetch(url, { guard, fetchImpl = fetch, accept = '*/*' }) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await guard(current);
    const res = await fetchImpl(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'en' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      const next = new URL(res.headers.get('location'), current);
      if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new FetchError('Redirect to non-http URL.');
      current = next.toString();
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new FetchError('Too many redirects.');
}

export function createFallback({ allowPrivateHosts = false, fetchImpl = fetch, guard } = {}) {
  const check = guard ?? (allowPrivateHosts ? async () => {} : (u) => assertPublicUrl(u));

  async function fetchImage(imageUrl) {
    try {
      const { res } = await guardedFetch(imageUrl, { guard: check, fetchImpl, accept: 'image/*' });
      if (!res.ok || !IMAGE_TYPES.test(res.headers.get('content-type') || '')) {
        await res.body?.cancel();
        return null;
      }
      return await readCapped(res, MAX_IMAGE_BYTES);
    } catch {
      return null; // a missing preview image is not worth failing the capture over
    }
  }

  async function capture(url) {
    const { res, finalUrl } = await guardedFetch(url, {
      guard: check,
      fetchImpl,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    });
    const type = res.headers.get('content-type') || '';
    if (!/html|xml/i.test(type)) {
      await res.body?.cancel();
      throw new FetchError(`Expected an HTML page but got "${type || 'unknown'}" (HTTP ${res.status}).`);
    }
    const html = (await readCapped(res, MAX_HTML_BYTES)).toString('utf8');
    const meta = extractMetadata(html, finalUrl);
    const image = meta.image ? await fetchImage(meta.image) : null;
    return { ...meta, finalUrl, httpStatus: res.status, image };
  }

  return { capture };
}
