// All untrusted site data goes in via textContent / attributes — never innerHTML.
const $ = (sel, root = document) => root.querySelector(sel);
const form = $('#capture-form');
const input = $('#url');
const submit = $('#submit');
const statusEl = $('#status');
const list = $('#sites');
const tpl = $('#card-tpl');

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

function renderCard(site) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  const img = $('.thumb', node);
  img.src = `${site.thumbnail}?v=${encodeURIComponent(site.capturedAt)}`;
  img.alt = `Screenshot of ${site.title}`;
  $('.thumb-link', node).href = site.url;
  $('.title', node).textContent = site.title;
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

async function refresh() {
  const sites = await api('GET', '/api/sites');
  list.replaceChildren(...sites.map(renderCard));
  $('#empty').hidden = sites.length > 0;
}

async function capture(url) {
  submit.disabled = true;
  setStatus(`Capturing ${url}… (this can take a few seconds)`, 'busy');
  try {
    const site = await api('POST', '/api/sites', { url });
    setStatus(`Captured “${site.title}”.`, 'ok');
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

refresh().catch((err) => setStatus(err.message, 'error'));
