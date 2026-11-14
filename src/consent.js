// Cookie/consent banner dismissal for headless captures.
// Layer 1 (request blocking) is handled in capture.js via CONSENT_HOSTS.
// Layer 2 (button clicks) and Layer 3 (CSS hiding) are handled by dismissConsent().

export const CONSENT_HOSTS = new Set([
  'cdn.cookielaw.org',            // OneTrust
  'optanon.blob.core.windows.net',
  'consent.cookiebot.com',        // Cookiebot
  'consentcdn.cookiebot.com',
  'sdk.privacy-center.org',       // Didomi
  'api.privacy-center.org',
  'cmp.quantcast.com',            // Quantcast
  'secure.quantcast.com',
  'consent.trustarc.com',         // TrustArc
  'app.usercentrics.eu',          // Usercentrics
]);

// Selectors tried in order: reject-first, then necessary-only, then accept as last resort.
const REJECT_SELECTORS = [
  '#onetrust-reject-all-handler',
  '#CybotCookiebotDialogBodyButtonDecline',
  '#didomi-notice-disagree-button',
  'button[aria-label*="Reject" i]',
];

const NECESSARY_SELECTORS = [
  '#onetrust-pc-btn-handler',
  '.didomi-components-button--tertiary',
];

const ACCEPT_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonAcceptSelected',
  '#didomi-notice-agree-button',
];

const REJECT_TEXT = /reject|decline|necessary only|refuse/i;
const ACCEPT_TEXT = /^(accept|agree|consent|ok|got it|i understand)$/i;

const HIDE_CSS = `
#onetrust-consent-sdk,.onetrust-pc-dark-filter,
#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay,
.didomi-popup-container,.didomi-popup-backdrop,
.qc-cmp2-container,#qc-cmp2-ui,
.truste_overlay,.truste_box_overlay,
#usercentrics-root,
[class*="cookie-banner"],[class*="cookie-consent"],
[class*="cookie-notice"],[id*="cookie-banner"],
[id*="cookie-consent"],[class*="gdpr-banner"],
[id*="gdpr"],[class*="consent-banner"]{
  display:none!important;visibility:hidden!important;
}
body{overflow:auto!important;position:static!important;}
`;

async function tryClick(frame, selectors) {
  for (const sel of selectors) {
    try {
      const loc = frame.locator(sel).first();
      if (await loc.isVisible({ timeout: 500 })) {
        await loc.click({ timeout: 500 });
        return true;
      }
    } catch {
      // not found or not clickable — try next
    }
  }
  return false;
}

async function tryTextClick(frame, pattern) {
  try {
    // Include <a> elements — some CMPs use links styled as buttons (e.g. CNN)
    const buttons = frame.locator('button, [role="button"], a');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      try {
        const btn = buttons.nth(i);
        if (!await btn.isVisible({ timeout: 200 })) continue;
        const text = (await btn.textContent({ timeout: 200 }) ?? '').trim();
        if (pattern.test(text)) {
          await btn.click({ timeout: 500 });
          return true;
        }
      } catch {
        // skip this button
      }
    }
  } catch {
    // frame may be detached
  }
  return false;
}

async function dismissFrame(frame) {
  if (await tryClick(frame, REJECT_SELECTORS)) return;
  if (await tryClick(frame, NECESSARY_SELECTORS)) return;
  if (await tryTextClick(frame, REJECT_TEXT)) return;
  if (await tryClick(frame, ACCEPT_SELECTORS)) return;
  await tryTextClick(frame, ACCEPT_TEXT);
}

export async function dismissConsent(page) {
  // Layer 2: click buttons in main frame and all iframes
  const frames = page.frames();
  await Promise.all(frames.map((f) => dismissFrame(f).catch(() => {})));

  // Layer 3: inject CSS to hide remaining overlays and undo scroll-lock
  await page.addStyleTag({ content: HIDE_CSS }).catch(() => {});
}
