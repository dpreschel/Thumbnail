// All untrusted site data goes in via textContent / attributes — never innerHTML.
const $ = (sel, root = document) => root.querySelector(sel);
const form = $('#capture-form');
const input = $('#url');
const submit = $('#submit');
const statusEl = $('#status');
const list = $('#sites');
const tpl = $('#card-tpl');
const sizeSelect = $('#size');

let sites = [];
let sizes = {}; // { small: 320, ... } from the server

const prefs = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode etc. */ } },
};

function setStatus(msg, kind = '') {
  statusEl.textContent = msg;
  statusEl.className = kind;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Pick the stored size closest to the chosen one (records may predate a size change). */
function thumbFor(site, wanted) {
  const available = site.thumbnails ? Object.keys(site.thumbnails) : [];
  if (!available.length) return site.thumbnail ?? null; // records saved by v0.1 had one size

  if (site.thumbnails[wanted]) return site.thumbnails[wanted];
  const target = sizes[wanted] ?? 640;
  available.sort((a, b) => Math.abs((sizes[a] ?? 640) - target) - Math.abs((sizes[b] ?? 640) - target));
  return site.thumbnails[available[0]];
}

function renderCard(site) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  const img = $('.thumb', node);
  const src = thumbFor(site, sizeSelect.value);
  if (src) {
    img.src = `${src}?v=${encodeURIComponent(site.capturedAt)}`;
    img.alt = `${site.captureMode === 'fallback' ? 'Preview image' : 'Screenshot'} of ${site.title}`;
  } else {
    img.hidden = true;
    $('.placeholder', node).hidden = false;
    $('.initial', node).textContent = (site.title || '?').trim().charAt(0).toUpperCase();
  }
  $('.thumb-link', node).href = site.url;
  $('.title', node).textContent = site.title;
  if (site.captureMode === 'fallback') {
    const badge = $('.badge', node);
    badge.hidden = false;
    badge.title = `The browser could not render this page, so only basic info was fetched.\n${site.fallbackReason || ''}`;
  }
  $('.site-name', node).textContent = site.siteName || '';
  $('.desc', node).textContent = site.description || 'No description provided.';
  $('.desc', node).classList.toggle('muted', !site.description);
  const link = $('.url', node);
  link.href = site.url;
  link.textContent = site.url;
  const when = $('.when', node);
  when.dateTime = site.capturedAt;
  when.textContent = `Captured ${new Date(site.capturedAt).toLocaleString()}`;
  $('.refresh', node).addEventListener('click', () => capture(site.inputUrl));
  $('.delete', node).addEventListener('click', async () => {
    try {
      await api('DELETE', `/api/sites/${site.id}`);
      await refresh();
    } catch (err) {
      setStatus(err.message, 'error');
    }
  });
  return node;
}

function render() {
  list.dataset.size = sizeSelect.value;
  list.replaceChildren(...sites.map(renderCard));
  $('#empty').hidden = sites.length > 0;
}

async function refresh() {
  sites = await api('GET', '/api/sites');
  render();
}

async function capture(url) {
  submit.disabled = true;
  setStatus(`Capturing ${url}… (this can take a few seconds)`, 'busy');
  try {
    const site = await api('POST', '/api/sites', { url });
    const how = site.captureMode === 'fallback' ? ' (basic capture — browser render failed)' : '';
    setStatus(`Captured “${site.title}”${how}.`, site.captureMode === 'fallback' ? 'warn' : 'ok');
    await refresh();
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    submit.disabled = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (url) capture(url).then(() => form.reset());
});

sizeSelect.addEventListener('change', () => {
  prefs.set('thumbSize', sizeSelect.value);
  render();
});

async function init() {
  ({ thumbnailSizes: sizes } = await api('GET', '/api/config'));
  const names = Object.keys(sizes).sort((a, b) => sizes[a] - sizes[b]);
  sizeSelect.replaceChildren(
    ...names.map((n) => new Option(`${n[0].toUpperCase()}${n.slice(1)} (${sizes[n]}px)`, n)),
  );
  const saved = prefs.get('thumbSize');
  sizeSelect.value = saved && sizes[saved] ? saved : (names.includes('medium') ? 'medium' : names[0]);
  await refresh();
}

init().catch((err) => setStatus(err.message, 'error'));
