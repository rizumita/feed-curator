async function toggleRead(id) {
  await fetch('/api/read/' + id, { method: 'POST' });
  const card = document.querySelector('[data-id="' + id + '"]');
  const btn = card.querySelector('.read-btn');
  const isRead = card.classList.toggle('read');
  btn.classList.toggle('is-read');
  btn.textContent = isRead ? '\u2713' : '';
  btn.title = isRead ? 'Mark unread' : 'Mark read';
  updateUnreadCount();
}

async function markRead(id) {
  const card = document.querySelector('[data-id="' + id + '"]');
  if (!card.classList.contains('read')) {
    await fetch('/api/read/' + id, { method: 'POST' });
    card.classList.add('read');
    const btn = card.querySelector('.read-btn');
    btn.classList.add('is-read');
    btn.textContent = '\u2713';
    btn.title = 'Mark unread';
    updateUnreadCount();
  }
}

function updateUnreadCount() {
  const unread = document.querySelectorAll('.card:not(.read)').length;
  document.getElementById('unread-count').textContent = unread;
}

// Theme management
function getPreferredTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) return saved;
  return 'auto';
}

function applyTheme(theme) {
  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem('theme', theme);
}

function cycleTheme() {
  const current = getPreferredTheme();
  const next = current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto';
  applyTheme(next);
}

// Apply saved theme on load
applyTheme(getPreferredTheme());

// --- Filter state from URL params ---
const params = new URLSearchParams(location.search);
let currentReadFilter = params.get('read') || 'unread';
let currentTagFilter = params.get('tag') || 'all';
let currentCategoryFilter = params.get('category') || 'all';

function updateURL() {
  const p = new URLSearchParams(location.search);
  currentReadFilter === 'all' ? p.delete('read') : p.set('read', currentReadFilter);
  currentTagFilter === 'all' ? p.delete('tag') : p.set('tag', currentTagFilter);
  currentCategoryFilter === 'all' ? p.delete('category') : p.set('category', currentCategoryFilter);
  const qs = p.toString();
  history.replaceState(null, '', qs ? '?' + qs : location.pathname);
}

function applyFilters() {
  document.querySelectorAll('.card').forEach(card => {
    const isRead = card.classList.contains('read');
    const tags = (card.dataset.tags || '').split(',').map(t => t.trim());
    const category = card.dataset.category || '';
    let show = true;
    if (currentReadFilter === 'unread' && isRead) show = false;
    if (currentReadFilter === 'read' && !isRead) show = false;
    if (currentTagFilter !== 'all' && !tags.includes(currentTagFilter)) show = false;
    if (currentCategoryFilter !== 'all' && category !== currentCategoryFilter) show = false;
    card.style.display = show ? '' : 'none';
  });
  document.querySelectorAll('.tier-section').forEach(sec => {
    const visible = sec.querySelectorAll('.card:not([style*="display: none"])').length;
    sec.style.display = visible ? '' : 'none';
  });
  // Update visible tags based on category
  const visibleTags = new Set();
  document.querySelectorAll('.card').forEach(card => {
    const cat = card.dataset.category || '';
    if (currentCategoryFilter !== 'all' && cat !== currentCategoryFilter) return;
    (card.dataset.tags || '').split(',').forEach(t => { const tr = t.trim(); if (tr) visibleTags.add(tr); });
  });
  document.querySelectorAll('.tag-filter:not([data-value="all"])').forEach(btn => {
    btn.style.display = visibleTags.has(btn.dataset.value) ? '' : 'none';
  });
  // Reset tag filter if current tag not in visible set
  if (currentTagFilter !== 'all' && !visibleTags.has(currentTagFilter)) {
    currentTagFilter = 'all';
    document.querySelectorAll('.tag-filter').forEach(b => {
      b.classList.toggle('active', (b.dataset.value || 'all') === 'all');
    });
    applyFilters();
    return;
  }
  updateURL();
}

function setActiveBtn(container, value) {
  document.querySelectorAll(container + ' .filter-btn').forEach(b => {
    b.classList.toggle('active', (b.dataset.value || 'all') === value);
  });
}

function filterArticles(mode) {
  currentReadFilter = mode;
  setActiveBtn('#read-filters', mode);
  applyFilters();
}

function filterByTag(tag) {
  currentTagFilter = tag;
  document.querySelectorAll('.tag-filter').forEach(b => {
    b.classList.toggle('active', (b.dataset.value || 'all') === tag);
  });
  applyFilters();
}

function filterByCategory(cat) {
  currentCategoryFilter = cat;
  setActiveBtn('#category-filters', cat);
  applyFilters();
}

async function markSectionRead(btn) {
  const section = btn.closest('.tier-section');
  const cards = section.querySelectorAll('.card:not(.read):not([style*="display: none"])');
  const ids = [...cards].map(c => Number(c.dataset.id));
  if (ids.length === 0) return;
  await fetch('/api/read-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });
  cards.forEach(card => {
    card.classList.add('read');
    const rb = card.querySelector('.read-btn');
    rb.classList.add('is-read');
    rb.textContent = '\u2713';
    rb.title = 'Mark unread';
  });
  updateUnreadCount();
}

async function dismissArticle(id) {
  await fetch('/api/dismiss/' + id, { method: 'POST' });
  const card = document.querySelector('[data-id="' + id + '"]');
  if (card) {
    card.style.display = 'none';
    const section = card.closest('.tier-section');
    if (section) {
      const visible = section.querySelectorAll('.card:not([style*="display: none"])').length;
      if (!visible) section.style.display = 'none';
    }
    updateUnreadCount();
  }
}

async function skipSectionAll(btn) {
  const section = btn.closest('.tier-section');
  const cards = section.querySelectorAll('.card:not(.read):not([style*="display: none"])');
  const ids = [...cards].map(c => Number(c.dataset.id));
  if (ids.length === 0) return;
  await fetch('/api/dismiss-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });
  cards.forEach(card => { card.style.display = 'none'; });
  const visible = section.querySelectorAll('.card:not([style*="display: none"])').length;
  if (!visible) section.style.display = 'none';
  updateUnreadCount();
}

async function skipCluster(btn, ids) {
  if (ids.length === 0) return;
  await fetch('/api/dismiss-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: ids })
  });
  const cluster = btn.closest('.briefing-cluster');
  if (cluster) cluster.style.display = 'none';
  updateUnreadCount();
}

function setView(view) {
  const p = new URLSearchParams(location.search);
  view === 'briefing' ? p.delete('view') : p.set('view', view);
  const qs = p.toString();
  location.href = qs ? '?' + qs : '/';
}

function setSort(sort) {
  const p = new URLSearchParams(location.search);
  sort === 'newest' ? p.delete('sort') : p.set('sort', sort);
  // Preserve other params
  if (currentReadFilter !== 'all') p.set('read', currentReadFilter);
  if (currentTagFilter !== 'all') p.set('tag', currentTagFilter);
  if (currentCategoryFilter !== 'all') p.set('category', currentCategoryFilter);
  const qs = p.toString();
  location.href = qs ? '?' + qs : '/';
}

// --- Actions (Fetch / Curate / Briefing) ---
async function runAction(action) {
  var btn = document.getElementById('btn-' + action);
  var status = document.getElementById('action-status');
  var labels = { fetch: 'Fetching feeds...', curate: 'AI curating...', briefing: 'Generating briefing...' };
  var endpoints = { fetch: '/api/fetch', curate: '/api/curate', briefing: '/api/briefing/generate' };

  btn.disabled = true;
  status.textContent = labels[action] || 'Running...';
  status.className = 'action-status running';

  try {
    var res = await fetch(endpoints[action], { method: 'POST' });
    var data = await res.json();
    if (action === 'fetch') {
      status.textContent = data.newArticles + ' new article(s) fetched.';
    } else if (action === 'curate') {
      status.textContent = data.curated + ' article(s) curated.';
    } else {
      status.textContent = data.ok ? 'Briefing generated.' : 'No articles for briefing.';
    }
    status.className = 'action-status done';
    // Reload page after a short delay to show updated data
    setTimeout(function() { location.reload(); }, 1500);
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.className = 'action-status error';
  } finally {
    btn.disabled = false;
  }
}

// --- Discover Feeds ---
async function discoverFeeds() {
  const input = document.getElementById('discover-topic');
  const btn = document.getElementById('discover-btn');
  const results = document.getElementById('discover-results');
  const topic = input.value.trim();
  if (!topic) return;

  btn.disabled = true;
  btn.textContent = 'Searching...';
  results.innerHTML = '<div class="discover-loading">Asking AI to find feeds...</div>';

  try {
    const res = await fetch('/api/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic })
    });
    const data = await res.json();

    if (!data.feeds || data.feeds.length === 0) {
      results.innerHTML = '<div class="discover-empty">No feeds found.</div>';
      return;
    }

    results.innerHTML = data.feeds.map((f, i) =>
      '<div class="discover-item" id="df-' + i + '">' +
        '<div class="discover-item-title">' + escapeText(f.title) + '</div>' +
        '<div class="discover-item-url">' + escapeText(f.url) + '</div>' +
        '<div class="discover-item-desc">' + escapeText(f.description) + '</div>' +
        '<button class="discover-add-btn" onclick="registerFeed(' + i + ', \'' + escapeAttr(f.url) + '\', \'' + escapeAttr(topic) + '\')">Add</button>' +
      '</div>'
    ).join('');
  } catch (e) {
    results.innerHTML = '<div class="discover-empty">Error: ' + e.message + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Search';
  }
}

async function registerFeed(idx, url, category) {
  const item = document.getElementById('df-' + idx);
  const btn = item.querySelector('.discover-add-btn');
  btn.disabled = true;
  btn.textContent = 'Adding...';

  const res = await fetch('/api/discover/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, category })
  });
  const data = await res.json();
  btn.textContent = data.added ? 'Added!' : 'Already exists';
  btn.classList.add('done');
}

function escapeText(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s) {
  return s.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// Restore filters on load
setActiveBtn('#read-filters', currentReadFilter);
setActiveBtn('#category-filters', currentCategoryFilter);
document.querySelectorAll('.tag-filter').forEach(b => {
  b.classList.toggle('active', (b.dataset.value || 'all') === currentTagFilter);
});
applyFilters();
