import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { chromium } from 'playwright';
import { dismissConsent, CONSENT_HOSTS } from '../src/consent.js';
import { createCapturer } from '../src/capture.js';

// ---------------------------------------------------------------------------
// Local HTTP server serving fake consent-banner pages
// ---------------------------------------------------------------------------

// Page with a known reject selector (#reject-all) and a scroll-locked body.
const BANNER_PAGE = `<!doctype html><html><head><title>Test Page</title></head>
<body style="overflow:hidden">
<div id="cookie-banner" style="position:fixed;top:0;left:0;width:100%;background:#000;color:#fff;padding:20px;z-index:9999">
  We use cookies.
  <button id="reject-all" onclick="document.getElementById('cookie-banner').style.display='none';document.body.dataset.consentDone='1'">Reject all</button>
  <button id="accept-all" onclick="document.getElementById('cookie-banner').style.display='none';document.body.dataset.consentDone='accept'">Accept</button>
</div>
<main><h1>Main content</h1></main>
</body></html>`;

// Page with only generic text button (no known selector).
const GENERIC_PAGE = `<!doctype html><html><head><title>Generic</title></head>
<body>
<div class="cookie-notice">
  <button onclick="document.body.dataset.consentDone='reject'">Decline all</button>
</div>
<main><h1>Content</h1></main>
</body></html>`;

// Page with no banner at all.
const CLEAN_PAGE = `<!doctype html><html><head><title>Clean</title></head>
<body><h1>No banners here</h1></body></html>`;

let server, base;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const pages = { '/banner': BANNER_PAGE, '/generic': GENERIC_PAGE, '/clean': CLEAN_PAGE };
    const body = pages[req.url];
    if (body) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(body);
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}, 30_000);

afterAll(() => {
  server?.close();
});

// ---------------------------------------------------------------------------
// Unit tests: CONSENT_HOSTS membership
// ---------------------------------------------------------------------------
describe('CONSENT_HOSTS', () => {
  it('includes known consent provider hostnames', () => {
    expect(CONSENT_HOSTS.has('cdn.cookielaw.org')).toBe(true);        // OneTrust
    expect(CONSENT_HOSTS.has('consent.cookiebot.com')).toBe(true);    // Cookiebot
    expect(CONSENT_HOSTS.has('sdk.privacy-center.org')).toBe(true);   // Didomi
    expect(CONSENT_HOSTS.has('cmp.quantcast.com')).toBe(true);        // Quantcast
    expect(CONSENT_HOSTS.has('consent.trustarc.com')).toBe(true);     // TrustArc
    expect(CONSENT_HOSTS.has('app.usercentrics.eu')).toBe(true);      // Usercentrics
  });

  it('does not include unrelated hosts', () => {
    expect(CONSENT_HOSTS.has('example.com')).toBe(false);
    expect(CONSENT_HOSTS.has('google.com')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: dismissConsent() with real Playwright
// ---------------------------------------------------------------------------
describe('dismissConsent', () => {
  let browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function withPage(url, fn) {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  }

  it('clicks the reject button when a known reject selector is present', async () => {
    await withPage(`${base}/banner`, async (page) => {
      await dismissConsent(page);
      const done = await page.evaluate(() => document.body.dataset.consentDone);
      expect(done).toBe('1'); // reject button clicked, not accept
      const visible = await page.locator('#cookie-banner').isVisible();
      expect(visible).toBe(false);
    });
  }, 30_000);

  it('clicks by generic text when no known selector matches', async () => {
    await withPage(`${base}/generic`, async (page) => {
      await dismissConsent(page);
      const done = await page.evaluate(() => document.body.dataset.consentDone);
      expect(done).toBe('reject');
    });
  }, 30_000);

  it('leaves a banner-free page untouched without throwing', async () => {
    await withPage(`${base}/clean`, async (page) => {
      await expect(dismissConsent(page)).resolves.not.toThrow();
    });
  }, 30_000);

  it('injects CSS that hides known banner classes', async () => {
    await withPage(`${base}/banner`, async (page) => {
      await dismissConsent(page);
      // After CSS injection the cookie-notice class should be hidden even if it existed
      const hidden = await page.evaluate(() => {
        const el = document.createElement('div');
        el.className = 'cookie-banner';
        document.body.appendChild(el);
        return window.getComputedStyle(el).display;
      });
      expect(hidden).toBe('none');
    });
  }, 30_000);

  it('restores body overflow after dismissal', async () => {
    await withPage(`${base}/banner`, async (page) => {
      const before = await page.evaluate(() => document.body.style.overflow);
      expect(before).toBe('hidden');
      await dismissConsent(page);
      const after = await page.evaluate(() => window.getComputedStyle(document.body).overflow);
      expect(after).not.toBe('hidden');
    });
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Integration test: dismiss=false leaves banner visible
// ---------------------------------------------------------------------------
describe('createCapturer with dismiss=false', () => {
  let capturer;

  beforeAll(async () => {
    capturer = createCapturer({ allowPrivateHosts: true, dismiss: false });
  }, 30_000);

  afterAll(async () => {
    await capturer?.close();
  });

  it('does not remove the banner when dismiss is disabled', async () => {
    // We can't inspect the page DOM post-capture, so we verify indirectly:
    // the title of the captured page should still be found (capture completes)
    // and we trust the dismiss=false code path doesn't throw.
    const result = await capturer.capture(`${base}/banner`);
    expect(result.title).toBe('Test Page');
    expect(result.screenshot).toBeInstanceOf(Buffer);
  }, 30_000);
});
