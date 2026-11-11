---
description: Run tests, start the app, capture a real site, and screenshot the UI to verify a change end to end
---

Verify the current state of the app end to end. $ARGUMENTS

1. Run `npm test`. If anything fails, stop and report the failures with output.
2. Start the server in the background on a spare port with a throwaway data dir:
   `DATA_DIR=$(mktemp -d) PORT=3999 node src/server.js`
3. Capture two sites through the API: one that should render normally (e.g. `nodejs.org`), and `http://169.254.169.254/`, which must return a 400 SSRF refusal. Show the key JSON fields for each (`title`, `captureMode`, `thumbnails`, or `error`).
4. Use Playwright (`require('playwright')`) to open http://127.0.0.1:3999, wait for `.card`, and take a screenshot at each thumbnail size by selecting each option in `#size`. Look at the screenshots and check for broken images, overflowing text and missing badges or placeholders.
5. Stop the server and summarize: tests, API results, anything visually wrong.
