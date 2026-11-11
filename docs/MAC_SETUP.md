# Running Site Thumbnailer on a Mac

These steps start from a fresh Mac (Apple Silicon or Intel, macOS 14 or later). Allow about 15 minutes, most of it downloads.

## 1. Prerequisites

```bash
# Homebrew (skip if `brew --version` already works)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Git, plus the GitHub CLI (handy for cloning private repos and PRs)
brew install git gh
gh auth login            # follow the prompts; choose HTTPS + browser login
```

## 2. Get the code

```bash
mkdir -p ~/code && cd ~/code
gh repo clone dpreschel/Thumbnail
cd Thumbnail
git checkout claude/admiring-ptolemy-angduw   # or `main`, once this branch is merged
```

## 3a. Run with Docker (recommended)

Pick one Docker runtime:

| Runtime | Install | Notes |
|---|---|---|
| **OrbStack** | `brew install --cask orbstack` | Fast, light on battery, free for personal use. Good default on Apple Silicon |
| Docker Desktop | `brew install --cask docker` | The official one; needs a paid license at larger companies |
| Colima | `brew install colima docker docker-compose && colima start --memory 4` | Free, CLI only |

Start the runtime app once so the `docker` command works. Then:

```bash
docker compose up --build -d      # first build downloads about 1 GB
open http://localhost:3000
```

Day-to-day commands:

```bash
docker compose logs -f            # watch logs (Ctrl-C to stop watching)
docker compose down               # stop (captured sites are kept)
docker compose up -d --build      # after pulling new code
docker compose down -v            # stop AND delete all captured sites
```

To use different thumbnail sizes:

```bash
THUMBNAIL_SIZES="tiny:160,card:480,hero:1920" docker compose up -d
```

## 3b. Run natively (better for hacking on the code)

```bash
brew install node@22
# Or with a version manager, which reads .nvmrc:  brew install nvm && nvm install

npm install
npm run browsers        # one-time: downloads Chromium (about 150 MB) for Playwright
npm test                # 72 tests, about 2 seconds
npm run dev             # http://127.0.0.1:3000, restarts when you save a file
```

Native runs keep data in `./data/` (git-ignored). Docker keeps it in the `thumbnailer-data` volume. The two are separate.

## 4. Pick up the work with Claude Code

```bash
curl -fsSL https://claude.ai/install.sh | bash     # or: brew install --cask claude-code
cd ~/code/Thumbnail
claude
```

Claude Code reads `CLAUDE.md` in the repo root automatically. That file has the architecture, commands, rules and roadmap, so a new session starts with the context. Useful first prompts:

- `/verify`: runs the tests, starts the app, captures a site and screenshots the UI (the command is defined in `.claude/commands/verify.md`)
- "Read CLAUDE.md and summarize where we left off"
- "Implement the job-queue item from the roadmap, with tests"

Optional: to have Claude Code ask permission less often, run `/permissions` inside Claude Code and allow commands such as `npm test`, `git diff` and `docker compose logs`. Or ask Claude to run the `fewer-permission-prompts` skill once you've used it for a while.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `port is already allocated` / `EADDRINUSE :3000` | Something else is on 3000. Run `PORT=3001 npm start`, or change the left side of `ports` in `docker-compose.yml` to `127.0.0.1:3001:3000` |
| Every card says **Basic capture** (native run) | Chromium isn't installed: `npm run browsers`. Hover the badge to see the exact error |
| `Executable doesn't exist ... chromium` | Same fix. If you upgraded Playwright, also bump the Dockerfile tag to match |
| Docker build is very slow or uses lots of CPU on Apple Silicon | You're emulating amd64. Remove any `DOCKER_DEFAULT_PLATFORM=linux/amd64` from your shell; the image is native arm64 |
| Chromium crashes in Docker (`Target closed`) | Give the Docker VM at least 4 GB RAM; keep `shm_size: 1gb` in compose |
| `SELF_SIGNED_CERT_IN_CHAIN` on `npm install` (corporate network) | Your company inspects TLS. Point Node at the company CA: `export NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem` |
| A site you expect to work gets `Refusing to visit non-public address` | Its DNS resolves to a private IP (common for VPN or intranet hosts). For local testing only: `ALLOW_PRIVATE_HOSTS=1 npm start` |
| `sharp` install errors | `rm -rf node_modules && npm install`; check that `node -p process.arch` says `arm64` on Apple Silicon |
