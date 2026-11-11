# CLAUDE.md

Context for Claude Code sessions in this repo.

## What this is

**Site Thumbnailer**: a proof of concept for a larger project. A user enters a URL. The app records the page's title, description and canonical URL, and saves a screenshot thumbnail in several sizes. There is deliberately no database.

Status: v0.2 is working. It has browser capture, a metadata-only fallback, configurable thumbnail sizes, Docker and CI. Development happens on branch `claude/admiring-ptolemy-angduw` (not yet merged to `main`).

## Commands

```bash
npm install && npm run browsers   # first time (Chromium for Playwright)
npm test                          # Vitest, ~72 tests, ~2s; MUST pass before committing
npm run dev                       # http://127.0.0.1:3000 with auto-restart
docker compose up --build -d      # containerized, http://localhost:3000
```

Environment variables: `PORT`, `HOST`, `DATA_DIR`, `THUMBNAIL_SIZES` (`name:width,...`), `DISABLE_BROWSER=1`, `ALLOW_PRIVATE_HOSTS=1` (local testing only).

## Architecture (src/)

Request flow: `app.js` POST /api/sites → `urlGuard.normalizeUrl` → `siteCapture` (tries `capture.js` with headless Chromium, else `fallback.js` with plain fetch + og:image) → `thumbnails.makeThumbnails` (sharp, one JPEG per size) → `store.upsert` (`data/sites.json` + `data/thumbnails/<id>-<size>.jpg`).

| File | Role |
|---|---|
| `urlGuard.js` | URL normalization, `isPublicIp`, `assertPublicUrl` (SSRF) |
| `capture.js` | Playwright; `page.route` guards every request; returns PNG + rendered metadata |
| `fallback.js` | `guardedFetch` with manual redirects + guard per hop; 2 MB HTML / 5 MB image caps; no SVG |
| `siteCapture.js` | Browser first, fallback second; sets `captureMode` / `fallbackReason`; never falls back on `UrlError` |
| `metadata.js` | Cheerio extraction with fallback order for each field |
| `thumbnails.js` | `parseSizes`, `makeThumbnails` (16:10, crop from top, 40 MP input cap) |
| `store.js` | JSON-file store: atomic temp+rename writes, serialized via a promise queue, upsert by canonical URL |
| `app.js` | `createApp({ store, capturer, sizes, logger })`: routes + error mapping (UrlError→400, load failure→502) |
| `server.js` | The only place dependencies are built; reads env vars |

Frontend: `public/` is vanilla JS with no build step. Cards come from a `<template>`. The size picker is built from `GET /api/config`.

Record shape: `{ id, inputUrl, url, finalUrl, title, description, siteName, httpStatus, captureMode, fallbackReason, thumbnails: {size: url} | null, capturedAt }`. v0.1 records instead have a single `thumbnail` string; the UI still handles them.

## Rules (don't break these)

- **Security first.** Never weaken the SSRF guard. Every new outbound fetch must go through `assertPublicUrl` (or `guardedFetch`) on **every redirect hop**. A `UrlError` must never trigger the fallback.
- **No `innerHTML`** with captured data in `public/`. Use `textContent` and attributes. Keep the CSP strict (no inline scripts or styles).
- **Dependency injection.** Modules take their dependencies as arguments; only `server.js` builds them. Keep it that way so tests can fake the browser, DNS and fetch.
- **Tests with every change.** Add or extend tests in `test/` with each change. Real-browser and real-HTTP tests use local servers with `allowPrivateHosts: true`; unit tests use fakes.
- **Verify in the running app**, not just in tests. Start the server, capture a site and screenshot the UI with Playwright (see `/verify`). Real UI bugs have slipped past green tests in this project before.
- **Playwright version lock.** The `playwright` version in `package.json` (exact, no `^`) must equal the tag in `Dockerfile` (`mcr.microsoft.com/playwright:vX.Y.Z-noble`). Bump both together.
- Thumbnail size names must match `^[a-z][a-z0-9]{0,15}$`; they become file names and URLs.
- `data/` is runtime state and is git-ignored. Never commit it.

## Roadmap (next steps, rough priority)

1. Rate limiting + auth (each capture launches a browser context)
2. Job queue with a concurrency cap (e.g. BullMQ); POST → 202, UI polls
3. Run capture on an isolated network to close the DNS-rebinding window
4. Real DB (SQLite/Postgres) + object storage for images
5. Scheduled re-capture; structured logs and metrics; ESLint + Prettier in CI
6. Optional full-page and mobile-viewport captures

## Docs

- `README.md`: features, API, configuration
- `docs/MAC_SETUP.md`: setup from a fresh Mac, plus troubleshooting
