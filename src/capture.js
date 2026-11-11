// Visit a page in headless Chromium: grab the rendered HTML (so JS-built pages
// still give us metadata) and a viewport screenshot to use as the thumbnail.
import { chromium } from 'playwright';
import { assertPublicUrl } from './urlGuard.js';
import { extractMetadata } from './metadata.js';

const VIEWPORT = { width: 1280, height: 800 };
const NAV_TIMEOUT_MS = 20_000;
const SETTLE_TIMEOUT_MS = 4_000;

export function createCapturer({ allowPrivateHosts = false, launchOptions = {} } = {}) {
  let browserPromise = null;

  const getBrowser = () => {
    browserPromise ??= chromium.launch(launchOptions).catch((err) => {
      browserPromise = null;
      throw err;
    });
    return browserPromise;
  };

  async function capture(url) {
    if (!allowPrivateHosts) await assertPublicUrl(url);

    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      javaScriptEnabled: true,
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    try {
      const page = await context.newPage();

      // Check *every* request (redirects, iframes, images, XHR) against the
      // SSRF guard, caching per-host verdicts for the life of this capture.
      if (!allowPrivateHosts) {
        const verdicts = new Map();
        await page.route('**/*', async (route) => {
          const reqUrl = route.request().url();
          if (!/^https?:/i.test(reqUrl)) return route.continue(); // data:, blob:
          const host = new URL(reqUrl).hostname;
          if (!verdicts.has(host)) {
            verdicts.set(host, assertPublicUrl(reqUrl).then(() => true, () => false));
          }
          return (await verdicts.get(host)) ? route.continue() : route.abort('blockedbyclient');
        });
      }

      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      if (!response) throw new Error('No response from site.');
      // Give lazy content a moment, but don't wait forever on chatty sites.
      await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});

      const finalUrl = page.url();
      const html = await page.content();
      const screenshot = await page.screenshot({ type: 'png' }) // lossless; resized to JPEG later;

      return {
        ...extractMetadata(html, finalUrl),
        finalUrl,
        httpStatus: response.status(),
        screenshot,
      };
    } finally {
      await context.close().catch(() => {});
    }
  }

  async function close() {
    if (browserPromise) {
      const b = await browserPromise.catch(() => null);
      browserPromise = null;
      await b?.close();
    }
  }

  return { capture, close };
}
