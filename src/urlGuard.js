// URL validation + SSRF protection.
// Anyone who can type a URL into this app can make the *server* visit it,
// so we must refuse internal targets (localhost, 10.x, 169.254.169.254 cloud
// metadata, etc.) — both for the initial URL and every request the browser makes.
import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export class UrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UrlError';
    this.status = 400;
  }
}

const MAX_URL_LENGTH = 2048;

/** Turn user input into a normalized http(s) URL, or throw UrlError. */
export function normalizeUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new UrlError('Please enter a URL.');
  }
  let raw = input.trim();
  if (raw.length > MAX_URL_LENGTH) throw new UrlError('URL is too long.');
  // Let people type "example.com" without a scheme.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlError('That does not look like a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlError('Only http and https URLs are supported.');
  }
  if (url.username || url.password) {
    throw new UrlError('URLs with embedded credentials are not allowed.');
  }
  if (!url.hostname || (!url.hostname.includes('.') && !url.hostname.startsWith('['))) {
    throw new UrlError('URL must include a full host name (e.g. example.com).');
  }
  url.hash = '';
  return url.toString();
}

/** True if the IP is publicly routable unicast (not private, loopback, link-local, ...). */
export function isPublicIp(ip) {
  let addr;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return false;
  }
  if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
    addr = addr.toIPv4Address();
  }
  return addr.range() === 'unicast';
}

/**
 * Resolve the URL's host and throw if any resolved address is non-public.
 * `lookup` is injectable for tests.
 */
export async function assertPublicUrl(urlString, { lookup = dns.lookup } = {}) {
  const { hostname } = new URL(urlString);
  const host = hostname.replace(/^\[|\]$/g, '');
  let addresses;
  if (ipaddr.isValid(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new UrlError(`Could not resolve host "${host}".`);
    }
  }
  if (addresses.length === 0 || !addresses.every(isPublicIp)) {
    throw new UrlError(`Refusing to visit non-public address for "${host}".`);
  }
}
