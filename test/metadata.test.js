import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { extractMetadata } from '../src/metadata.js';

const full = fs.readFileSync(new URL('./fixtures/full.html', import.meta.url), 'utf8');

describe('extractMetadata', () => {
  it('prefers OG title, meta description, and resolves a relative canonical', () => {
    expect(extractMetadata(full, 'https://example.com/start?x=1')).toEqual({
      title: 'OG Title',
      description: 'A meta description.',
      url: 'https://example.com/canonical/page',
      siteName: 'Example Site',
      image: 'https://example.com/img/share.png',
    });
  });

  it('falls back to <title>, og:description and the page URL', () => {
    const html = `<html><head><title>Hello</title>
      <meta property="og:description" content="from og"></head></html>`;
    expect(extractMetadata(html, 'https://a.test/')).toMatchObject({
      title: 'Hello', description: 'from og', url: 'https://a.test/', siteName: null, image: null,
    });
  });

  it('finds twitter:image when there is no og:image, and ignores data: images', () => {
    expect(extractMetadata('<meta name="twitter:image" content="//cdn.a.test/x.jpg">', 'https://a.test/').image)
      .toBe('https://cdn.a.test/x.jpg');
    expect(extractMetadata('<meta property="og:image" content="data:image/png;base64,AAA">', 'https://a.test/').image)
      .toBeNull();
  });

  it('uses og:url when there is no canonical', () => {
    const html = '<meta property="og:url" content="https://a.test/real">';
    expect(extractMetadata(html, 'https://a.test/tracking?utm=1').url).toBe('https://a.test/real');
  });

  it('ignores non-http canonical links', () => {
    const html = '<link rel="canonical" href="javascript:alert(1)">';
    expect(extractMetadata(html, 'https://a.test/').url).toBe('https://a.test/');
  });

  it('falls back to <h1>, then hostname, when there is no title', () => {
    expect(extractMetadata('<h1>Big</h1>', 'https://a.test/').title).toBe('Big');
    expect(extractMetadata('', 'https://a.test/').title).toBe('a.test');
    expect(extractMetadata('', 'https://a.test/').description).toBeNull();
  });

  it('truncates absurdly long values', () => {
    const html = `<title>${'x'.repeat(5000)}</title>`;
    const { title } = extractMetadata(html, 'https://a.test/');
    expect(title.length).toBe(300);
    expect(title.endsWith('…')).toBe(true);
  });
});
