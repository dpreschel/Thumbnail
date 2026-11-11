# Site Thumbnailer (POC)

Enter a website and the app captures:

- **Title** (`og:title` → `twitter:title` → `<title>` → `<h1>` → hostname)
- **Description** (`meta description` → `og:description` → `twitter:description`)
- **Full URL** (`<link rel=canonical>` → `og:url` → final URL after redirects)
- **Thumbnail**, a 1280×800 JPEG screenshot taken with headless Chromium

Results are kept in `data/sites.json`, and the images go in `data/thumbnails/`. There's no database.

## Quick start (macOS / Linux)

```bash
npm install
npm run browsers   # one-time: downloads Chromium for Playwright
npm start          # http://127.0.0.1:3000
```

`npm run dev` restarts the server whenever a file changes. You can set these environment variables: `PORT`, `HOST` (default `127.0.0.1`), `DATA_DIR` (default `./data`) and `ALLOW_PRIVATE_HOSTS=1`. The last one switches off the SSRF guard so you can capture a local dev server. Only use it on your own machine.

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/sites` | Lists the records, newest first |
| `POST` | `/api/sites` `{ "url": "example.com" }` | Captures the site. Returns 201 when new and 200 when the URL was already captured (the record is updated). Bad or forbidden URL → 400, site failed to load → 502 |
| `DELETE` | `/api/sites/:id` | Deletes the record and its thumbnail |
| `GET` | `/thumbnails/:id.jpg` | The image |

## Layout

```
src/urlGuard.js   URL normalization + SSRF protection (DNS-resolves, blocks private/loopback/link-local/metadata IPs)
src/metadata.js   HTML → {title, description, url, siteName} with Cheerio
src/capture.js    Playwright: load page, run every request through the guard, read rendered HTML, screenshot
src/store.js      JSON-file + thumbnail-folder store (atomic writes, serialized)
src/app.js        Express routes, security headers, error mapping (deps injected for testing)
src/server.js     Entry point
public/           Vanilla JS UI (no build step; untrusted data rendered via textContent only)
test/             Vitest unit + API tests, plus a real-browser integration test
```

## Tests

```bash
npm test          # or: npm run test:watch
```

CI (`.github/workflows/ci.yml`) runs the full suite, including the real-Chromium test, on every push.

## Security notes

You're letting users make your server open arbitrary URLs, which is a textbook SSRF setup. Here's what's in place:

- Only `http`/`https`. URLs with embedded credentials are rejected.
- The host is resolved, and the request is refused if **any** of its addresses is non-public. That covers 10/8, 127/8, 169.254/16 (cloud metadata), 100.64/10, IPv6 ULA/link-local and IPv4-mapped addresses.
- **Every** request the browser makes (redirects, iframes, sub-resources) goes through the same check via `page.route`.
- Downloads and service workers are disabled. Each capture runs in a fresh browser context.
- The UI uses a strict CSP and never injects captured text with `innerHTML`.

## Before this goes beyond a POC

- Rate limiting and auth (each capture is expensive: it runs a headless browser)
- A job queue with a concurrency cap, so captures don't hold HTTP requests open
- Smaller thumbnails (e.g. `sharp`) plus a full-size version
- A real database and object storage (S3 etc.)
- Run the browser in its own sandboxed container/network for defense in depth. Even with the IP checks, a short DNS-rebinding window between our lookup and Chromium's is possible.
