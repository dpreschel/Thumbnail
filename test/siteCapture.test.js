import { describe, it, expect, vi } from 'vitest';
import { createSiteCapturer } from '../src/siteCapture.js';
import { UrlError } from '../src/urlGuard.js';

const logger = { warn: vi.fn() };
const ok = (extra) => vi.fn(async () => ({ title: 'T', url: 'https://a.test/', ...extra }));
const fail = (err) => vi.fn(async () => { throw err; });

describe('createSiteCapturer', () => {
  it('uses the browser when it works', async () => {
    const browser = { capture: ok({ screenshot: Buffer.from('png') }) };
    const fallback = { capture: ok() };
    const r = await createSiteCapturer({ browser, fallback, logger }).capture('https://a.test/');
    expect(r).toMatchObject({ captureMode: 'browser', image: Buffer.from('png'), fallbackReason: null });
    expect(fallback.capture).not.toHaveBeenCalled();
  });

  it('falls back when the browser fails, recording why', async () => {
    const browser = { capture: fail(new Error('page.goto: Timeout 20000ms exceeded.\nCall log: ...')) };
    const fallback = { capture: ok({ image: null }) };
    const r = await createSiteCapturer({ browser, fallback, logger }).capture('https://a.test/');
    expect(r).toMatchObject({ captureMode: 'fallback', fallbackReason: 'page.goto: Timeout 20000ms exceeded.' });
  });

  it('works with no browser at all (DISABLE_BROWSER=1)', async () => {
    const r = await createSiteCapturer({ browser: null, fallback: { capture: ok() } }).capture('https://a.test/');
    expect(r).toMatchObject({ captureMode: 'fallback', fallbackReason: 'Browser capture disabled' });
  });

  it('never falls back after an SSRF refusal', async () => {
    const fallback = { capture: ok() };
    const c = createSiteCapturer({ browser: { capture: fail(new UrlError('non-public')) }, fallback, logger });
    await expect(c.capture('http://10.0.0.1/')).rejects.toThrow(UrlError);
    expect(fallback.capture).not.toHaveBeenCalled();
  });

  it('surfaces the browser error when both paths fail', async () => {
    const c = createSiteCapturer({
      browser: { capture: fail(new Error('net::ERR_NAME_NOT_RESOLVED')) },
      fallback: { capture: fail(new Error('fetch failed')) },
      logger,
    });
    await expect(c.capture('https://nope.test/')).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
  });
});
