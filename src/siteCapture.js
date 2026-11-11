// Try the real browser first; if it fails for any reason other than "you're not
// allowed to visit that", fall back to a plain HTTP fetch.
import { UrlError } from './urlGuard.js';

export function createSiteCapturer({ browser, fallback, logger = console }) {
  return {
    async capture(url) {
      let browserError;
      if (browser) {
        try {
          const r = await browser.capture(url);
          return { ...r, image: r.screenshot, captureMode: 'browser', fallbackReason: null };
        } catch (err) {
          if (err instanceof UrlError) throw err; // SSRF refusal: do not retry another way
          browserError = err;
          logger.warn?.(`Browser capture failed for ${url}, using fallback: ${firstLine(err)}`);
        }
      }
      try {
        const r = await fallback.capture(url);
        return {
          ...r,
          captureMode: 'fallback',
          fallbackReason: browserError ? firstLine(browserError) : 'Browser capture disabled',
        };
      } catch (err) {
        if (err instanceof UrlError) throw err;
        throw browserError ?? err; // the browser's error is usually the more informative one
      }
    },
    close: () => browser?.close?.(),
  };
}

const firstLine = (err) => String(err?.message ?? err).split('\n')[0].slice(0, 300);
