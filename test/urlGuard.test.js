import { describe, it, expect } from 'vitest';
import { normalizeUrl, isPublicIp, assertPublicUrl, UrlError } from '../src/urlGuard.js';

describe('normalizeUrl', () => {
  it('adds https:// when no scheme is given', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
  });
  it('keeps http and strips the fragment', () => {
    expect(normalizeUrl(' http://example.com/a?b=1#frag ')).toBe('http://example.com/a?b=1');
  });
  it.each([
    ['', /enter a URL/],
    ['ftp://example.com', /Only http and https/],
    ['javascript://alert(1)', /Only http and https/],
    ['https://user:pw@example.com', /credentials/],
    ['localhost', /full host name/],
    ['https://exa mple.com', /valid URL/],
    [`https://example.com/${'a'.repeat(3000)}`, /too long/],
  ])('rejects %j', (input, msg) => {
    expect(() => normalizeUrl(input)).toThrow(msg);
  });
  it('rejects non-strings', () => {
    expect(() => normalizeUrl(undefined)).toThrow(UrlError);
    expect(() => normalizeUrl({})).toThrow(UrlError);
  });
});

describe('isPublicIp', () => {
  it.each(['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111'])('%s is public', (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });
  it.each([
    '127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', 'garbage',
  ])('%s is not public', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  const fakeLookup = (map) => async (host) => {
    if (!(host in map)) throw new Error('ENOTFOUND');
    return map[host].map((address) => ({ address }));
  };

  it('passes when every resolved address is public', async () => {
    await expect(
      assertPublicUrl('https://good.test/', { lookup: fakeLookup({ 'good.test': ['93.184.216.34'] }) }),
    ).resolves.toBeUndefined();
  });
  it('fails if ANY resolved address is private (DNS rebinding-ish)', async () => {
    const lookup = fakeLookup({ 'sneaky.test': ['93.184.216.34', '10.0.0.1'] });
    await expect(assertPublicUrl('https://sneaky.test/', { lookup })).rejects.toThrow(/non-public/);
  });
  it('fails on literal private IPs without DNS', async () => {
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/non-public/);
    await expect(assertPublicUrl('http://[::1]:8080/')).rejects.toThrow(/non-public/);
  });
  it('fails on unresolvable hosts', async () => {
    await expect(assertPublicUrl('https://nope.test/', { lookup: fakeLookup({}) })).rejects.toThrow(/resolve/);
  });
});
