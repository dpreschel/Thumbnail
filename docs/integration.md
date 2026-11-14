# Integrating the Thumbnailer into Another Project

How to reuse the capture pipeline (screenshot, metadata, consent dismissal, thumbnails) in a larger codebase, and what to clean up before doing so.

## What's portable today

These modules have no Express or storage dependency and can be copied as-is:

| Module | What it gives you |
|---|---|
| `urlGuard.js` | `normalizeUrl`, `assertPublicUrl` (SSRF guard), `UrlError` |
| `capture.js` | `createCapturer({ allowPrivateHosts, dismiss, launchOptions })` → `.capture(url)` returns metadata + PNG `screenshot` |
| `consent.js` | `CONSENT_HOSTS`, `dismissConsent(page)`; usable with any Playwright page |
| `fallback.js` | `createFallback({ allowPrivateHosts })`: plain-fetch capture with per-hop SSRF checks |
| `siteCapture.js` | `createSiteCapturer({ browser, fallback })`: browser first, fallback second |
| `metadata.js` | `extractMetadata(html, url)`: pure function |
| `thumbnails.js` | `parseSizes`, `makeThumbnails(image, sizes)`: pure function, returns `{ size: Buffer }` |

Minimal wiring in a host app:

```js
import { createCapturer } from './thumbnailer/capture.js';
import { createFallback } from './thumbnailer/fallback.js';
import { createSiteCapturer } from './thumbnailer/siteCapture.js';
import { makeThumbnails, DEFAULT_SIZES } from './thumbnailer/thumbnails.js';

const capturer = createSiteCapturer({
  browser: createCapturer({ dismiss: true }),
  fallback: createFallback(),
});

const result = await capturer.capture('https://example.com');
const images = result.image ? await makeThumbnails(result.image, DEFAULT_SIZES) : null;
// persist `result` fields and `images` however the host app stores things
await capturer.close(); // on shutdown
```

Leave `app.js`, `server.js`, `store.js` and `public/` behind. They are POC-specific.

## What needs attention before lifting

### 1. Define a storage interface
`store.js` mixes three concerns: record persistence (`data/sites.json`), image file storage (`data/thumbnails/`), and public URL building (`/thumbnails/<id>-<size>.jpg`). `app.js` also serves `store.thumbDir` as static files.

Split it into:
- a **record store**: `list()`, `get(id)`, `upsert(fields)` → `{ record, created }`, `remove(id)`
- an **image store**: `put(id, size, buffer)` → URL, `removeAll(id)`

Then the host app can back them with Postgres/SQLite and S3/local disk without touching the pipeline.

### 2. Add types
The record shape and `capture()` return value are only documented in `CLAUDE.md`. Add JSDoc `@typedef`s (or a `.d.ts` file) for:
- `CaptureResult`: `{ title, description, url, finalUrl, siteName, httpStatus, image, captureMode, fallbackReason }`
- `SiteRecord`: the stored shape

This is the single biggest help for integration because the host's editor will know what comes back.

### 3. Make capture settings configurable
`VIEWPORT`, `NAV_TIMEOUT_MS` and `SETTLE_TIMEOUT_MS` are constants in `capture.js`. Expose them as `createCapturer` options with the current values as defaults.

### 4. Allow a shared browser
`createCapturer` always launches its own Chromium. Accept an optional `browser` (or `getBrowser`) argument so a host app that already runs Playwright can share one instance and control its lifecycle.

### 5. Make consent rules extendable
Selectors, text patterns and hide-CSS are module constants in `consent.js`. Export the defaults and let callers pass extra rules (e.g. `createCapturer({ consent: { extraSelectors, extraHosts } })`) so site-specific fixes don't require editing the library.

### 6. Logging
`siteCapture.js` takes a `logger` (default `console`); `capture.js` and `consent.js` don't log at all. Thread the same `logger` through so the host's structured logging captures fallbacks and consent clicks.

## Rules to keep when integrating

- **Keep the SSRF guard.** Don't pass `allowPrivateHosts: true` in production. Any new fetch path must go through `assertPublicUrl` / `guardedFetch` on every redirect hop, and a `UrlError` must never trigger the fallback.
- **Keep dependency injection.** Only the host's composition root should construct capturers and stores.
- **Pin Playwright.** The host must use the same exact `playwright` version as its Docker image (`mcr.microsoft.com/playwright:vX.Y.Z-noble`).
- **Heavy dependencies:** `playwright` (plus Chromium download), `sharp` (native), `cheerio`. The host must accept these.
- **Concurrency:** captures are slow (seconds) and memory-heavy. A multi-user host should put them behind a job queue with a concurrency cap (see the roadmap in `CLAUDE.md`).

## Packaging options

1. **Copy the portable modules** into the host app (e.g. `src/thumbnailer/`). Simplest, but fixes have to be ported by hand.
2. **Workspace package**: if the host is a monorepo, move the modules into `packages/thumbnailer` with its own `package.json` and import it as `@yourorg/thumbnailer`.
3. **Private npm package**: same as 2, published, for use across several projects.

Recommended order: do items 1 and 2 above first (storage interface, types), then pick a packaging option. The rest can follow as needed.
