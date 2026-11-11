# Site Thumbnailer (POC)

Enter a website and the app captures:

- **Title** (`og:title` → `twitter:title` → `<title>` → `<h1>` → hostname)
- **Description** (`meta description` → `og:description` → `twitter:description`)
- **Full URL** (`<link rel=canonical>` → `og:url` → final URL after redirects)
- **Thumbnails** of the page as it looks now, in several sizes (default **small 320px / medium 640px / large 1280px**, all 16:10 JPEGs)

Records live in `data/sites.json` and images in `data/thumbnails/`. There's no database.

## Running it on a Mac

> **New Mac or first time?** Follow [docs/MAC_SETUP.md](docs/MAC_SETUP.md). It covers Homebrew, cloning, Docker runtimes, Claude Code and troubleshooting.

### Option A: Docker (recommended, nothing else to install)

You need a Docker runtime: [Docker Desktop](https://www.docker.com/products/docker-desktop/), [OrbStack](https://orbstack.dev) (lighter, and nice on Apple Silicon) or `brew install colima docker docker-compose && colima start`.

```bash
docker compose up --build -d     # or: npm run docker:up
open http://localhost:3000
docker compose logs -f           # or: npm run docker:logs
docker compose down              # or: npm run docker:down   (data is kept)
docker compose down -v           # ...and also delete the stored sites/thumbnails
```

The image is based on the official Playwright image, which is multi-arch, so it runs natively on Apple Silicon and Intel. Data is kept in the `thumbnailer-data` volume. The port is bound to `127.0.0.1` only. To change the thumbnail sizes:

```bash
THUMBNAIL_SIZES="tiny:160,card:480,hero:1920" docker compose up -d
```

### Option B: Native Node

Requires Node 20+ (`brew install node`).

```bash
npm install
npm run browsers   # one-time: downloads Chromium for Playwright
npm start          # http://127.0.0.1:3000   (npm run dev = auto-restart on changes)
```

## Configuration (environment variables)

| Variable | Default | |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Docker sets `HOST=0.0.0.0` inside the container |
| `DATA_DIR` | `./data` | `/data` in Docker |
| `THUMBNAIL_SIZES` | `small:320,medium:640,large:1280` | `name:width` pairs, widths 32–2560. The UI's size menu is built from this list |
| `DISABLE_BROWSER` | unset | `1` = metadata-only mode, which skips Chromium entirely |
| `ALLOW_PRIVATE_HOSTS` | unset | `1` turns **off** the SSRF guard so you can capture e.g. a local dev server. Only use it on your own machine |

## How a capture works

```
POST /api/sites {url}
  └─ normalize + SSRF check
  └─ 1. Headless Chromium: load page, read rendered HTML, take a PNG screenshot
  │     (every request the page makes goes through the SSRF check)
  └─ 2. If that fails (timeout, bot wall, crash, Chromium missing):
  │     FALLBACK: plain HTTP fetch of the HTML → metadata,
  │     and the site's og:image / twitter:image as the picture (if any)
  └─ sharp → one JPEG per configured size → data/thumbnails/<id>-<size>.jpg
```

A fallback record has `captureMode: "fallback"` and a `fallbackReason`. The UI shows a "Basic capture" badge (hover it to see the reason). If there's no image at all, the card shows a placeholder.

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/sites` | Lists the records, newest first |
| `POST` | `/api/sites` `{ "url": "example.com" }` | Captures the site. Returns 201 when new and 200 when the URL was already captured (the record is updated). Bad or forbidden URL → 400, site failed to load by either method → 502 |
| `DELETE` | `/api/sites/:id` | Deletes the record and its thumbnails |
| `GET` | `/api/config` | `{ thumbnailSizes: { small: 320, ... } }` |
| `GET` | `/thumbnails/<id>-<size>.jpg` | The images. The URLs are listed in each record's `thumbnails` map |
| `GET` | `/healthz` | Used by the Docker health check |

## Layout

```
src/urlGuard.js     URL normalization + SSRF protection
src/capture.js      Playwright capture (rendered HTML + screenshot)
src/fallback.js     Plain-HTTP fallback (guarded redirects, size caps, og:image)
src/siteCapture.js  Browser-first, fallback-second orchestration
src/thumbnails.js   sharp resizing + THUMBNAIL_SIZES parsing
src/metadata.js     HTML → {title, description, url, siteName, image}
src/store.js        JSON-file + thumbnail-folder store (atomic, serialized writes)
src/app.js          Express routes, security headers, error mapping (deps injected)
src/server.js       Entry point / wiring
public/             Vanilla JS UI (no build step; untrusted data via textContent only)
test/               Vitest: unit, API, fallback-over-HTTP, and real-Chromium tests
```

## Tests

```bash
npm test          # or: npm run test:watch
```

CI (`.github/workflows/ci.yml`) runs the full suite, including the real-Chromium test, and also builds the Docker image.

## Security notes

You're letting users make your server open arbitrary URLs, which is a textbook SSRF setup. Here's what's in place:

- Only `http`/`https`. URLs with embedded credentials are rejected.
- The host is resolved, and the request is refused if **any** of its addresses is non-public. That covers 10/8, 127/8, 169.254/16 (cloud metadata), 100.64/10, IPv6 ULA/link-local and IPv4-mapped addresses.
- **Every** browser request (redirects, iframes, sub-resources) and **every** fallback redirect hop goes through the same check. An SSRF refusal never triggers the fallback.
- The fallback caps pages at 2 MB and images at 5 MB, times out after 10 s, and refuses SVG. sharp caps decoded pixels.
- Downloads and service workers are disabled, and each capture gets a fresh browser context. The container runs as a non-root user.
- The UI uses a strict CSP and never injects captured text with `innerHTML`.

## Before this goes beyond a POC

- Rate limiting and auth (each capture runs a headless browser)
- A job queue with a concurrency cap, so captures don't hold HTTP requests open
- A real database and object storage (S3 etc.)
- Run the browser on its own isolated network. Even with the IP checks, a short DNS-rebinding window between our lookup and the actual connection is possible.

## License

MIT, see [LICENSE](LICENSE).
