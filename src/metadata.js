// Pull title / description / canonical URL out of an HTML document.
import * as cheerio from 'cheerio';

const MAX_TITLE = 300;
const MAX_DESCRIPTION = 1000;

function clean(text, max) {
  if (!text) return null;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function resolveHttpUrl(href, base) {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} html     page HTML
 * @param {string} pageUrl  the URL the HTML was actually loaded from (after redirects)
 */
export function extractMetadata(html, pageUrl) {
  const $ = cheerio.load(html ?? '');
  const meta = (selector) => $(selector).first().attr('content');

  const title = clean(
    meta('meta[property="og:title"]') ||
      meta('meta[name="twitter:title"]') ||
      $('head > title').first().text() ||
      $('title').first().text() ||
      $('h1').first().text(),
    MAX_TITLE,
  );

  const description = clean(
    meta('meta[name="description"]') ||
      meta('meta[property="og:description"]') ||
      meta('meta[name="twitter:description"]'),
    MAX_DESCRIPTION,
  );

  const url =
    resolveHttpUrl($('link[rel="canonical"]').first().attr('href'), pageUrl) ||
    resolveHttpUrl(meta('meta[property="og:url"]'), pageUrl) ||
    pageUrl;

  const siteName = clean(meta('meta[property="og:site_name"]'), MAX_TITLE);

  return { title: title ?? new URL(pageUrl).hostname, description, url, siteName };
}
