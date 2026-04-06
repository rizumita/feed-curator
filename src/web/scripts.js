function hideCompletedClusters(card) {
  var cluster = card.closest('.briefing-cluster');
  if (!cluster) return;
  var cards = cluster.querySelectorAll('.card');
  var hasUnprocessed = false;
  cards.forEach(function(c) {
    var dismissed = c.style.display === 'none';
    var read = c.classList.contains('read');
    if (!dismissed && !read) hasUnprocessed = true;
  });
  if (!hasUnprocessed) cluster.style.display = 'none';
}

async function toggleRead(id) {
  await fetch('/api/read/' + id, { method: 'POST' });
  const card = document.querySelector('[data-id="' + id + '"]');
  const btn = card.querySelector('.read-btn');
  const isRead = card.classList.toggle('read');
  btn.classList.toggle('is-read');
  btn.textContent = isRead ? '\u2713' : '';
  btn.title = isRead ? 'Mark unread' : 'Mark read';
  updateUnreadCount();
  applyFilters();
  hideCompletedClusters(card);
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
    applyFilters();
    hideCompletedClusters(card);
  }
}

function updateUnreadCount() {
  const unread = document.querySelectorAll('.card:not(.read)').length;
  document.getElementById('unread-count').textContent = unread;
}

function setCountText(id, value) {
  var element = document.getElementById(id);
  if (element) element.textContent = String(value);
}

async function refreshSidebarStats() {
  try {
    var res = await fetch('/api/stats');
    if (!res.ok) return;
    var stats = await res.json();
    setCountText('unread-count', stats.unread);
    setCountText('curated-count', stats.curated);
    setCountText('pending-count', stats.total - stats.curated);
    setCountText('feeds-count', stats.feeds);
    setCountText('archived-count', stats.archived);
  } catch (_error) {
    // Leave the current values in place if the refresh request fails.
  }
}

function renderEmptyFeedsState() {
  return '<div class="empty"><h2>No feeds registered</h2><p>Use the search box in the sidebar to discover and add feeds.</p></div>';
}

function updateFeedsViewAfterRemoval() {
  var feedsView = document.getElementById('feeds-view');
  if (!feedsView) return;

  document.querySelectorAll('.feeds-category').forEach(function(section) {
    var count = section.querySelectorAll('.feed-card').length;
    var countEl = section.querySelector('[data-category-count]');
    if (countEl) countEl.textContent = String(count);
    if (count === 0) section.remove();
  });

  var total = document.querySelectorAll('.feed-card').length;
  setCountText('feeds-total-count', total);

  if (total === 0) {
    feedsView.innerHTML = renderEmptyFeedsState();
  }
}

function updateTocCounts() {
  document.querySelectorAll('.toc-link').forEach(function(link) {
    var href = link.getAttribute('href');
    if (!href) return;
    var sectionId = href.split('#')[1];
    var section = document.getElementById(sectionId);
    var countEl = link.querySelector('.toc-count');
    if (section && countEl) {
      var visible = section.querySelectorAll('.card:not([style*="display: none"])').length;
      countEl.textContent = visible;
      link.style.display = visible ? '' : 'none';
    }
  });
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

var currentPeriodDays = 7;

function filterByPeriod(days) {
  currentPeriodDays = days === 'all' ? 0 : Number(days);
  applyFilters();
}

function applyFilters() {
  var cutoff = currentPeriodDays > 0 ? Date.now() - currentPeriodDays * 24 * 60 * 60 * 1000 : 0;
  document.querySelectorAll('.card').forEach(card => {
    const isRead = card.classList.contains('read');
    const tags = (card.dataset.tags || '').split(',').map(t => t.trim());
    const category = card.dataset.category || '';
    let show = true;
    if (currentReadFilter === 'unread' && isRead) show = false;
    if (currentReadFilter === 'read' && !isRead) show = false;
    if (currentTagFilter !== 'all' && !tags.includes(currentTagFilter)) show = false;
    if (currentCategoryFilter !== 'all' && category !== currentCategoryFilter) show = false;
    if (cutoff > 0 && card.dataset.date) {
      var articleDate = new Date(card.dataset.date).getTime();
      if (articleDate < cutoff) show = false;
    }
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
  updateTocCounts();
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
    hideCompletedClusters(card);
    card.style.display = 'none';
    const section = card.closest('.tier-section');
    if (section) {
      const visible = section.querySelectorAll('.card:not([style*="display: none"])').length;
      if (!visible) section.style.display = 'none';
    }
    updateUnreadCount();
    updateTocCounts();
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
  updateTocCounts();
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

// --- Feed management ---
async function removeFeed(id) {
  if (!confirm('Remove this feed and all its articles?')) return;
  var res = await fetch('/api/feeds/' + id, { method: 'DELETE' });
  if (!res.ok) return;
  var card = document.querySelector('[data-feed-id="' + id + '"]');
  if (card) {
    card.remove();
    updateFeedsViewAfterRemoval();
  }
  await refreshSidebarStats();
}

// --- Language setting ---
async function setLanguage(lang) {
  var res = await fetch('/api/config/language', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: lang })
  });
  if (res.ok) {
    var banner = document.getElementById('lang-banner');
    if (banner) banner.style.display = 'none';
    location.reload();
  }
}

// --- SSE stream reader helper ---
async function readSSE(res, onMessage, onDone, onError) {
  var reader = res.body.getReader();
  var decoder = new TextDecoder();
  var buffer = '';
  while (true) {
    var result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    var lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('data: ')) {
        try {
          var event = JSON.parse(lines[i].slice(6));
          if (event.error) { onError(event.error); return; }
          if (event.done) { onDone(event); return; }
          if (event.message) onMessage(event.message);
        } catch(e) {}
      }
    }
  }
}

// --- Update: Fetch → Curate → Briefing (SSE) ---
function getUpdateButtons() {
  return document.querySelectorAll('#btn-update, .update-btn');
}

async function runUpdate() {
  var buttons = getUpdateButtons();
  var status = document.getElementById('action-status');

  buttons.forEach(function(b) { b.disabled = true; b.textContent = 'Updating...'; });
  status.textContent = 'Updating...';
  status.className = 'action-status running';

  try {
    var res = await fetch('/api/update', { method: 'POST' });
    await readSSE(res,
      function(msg) { status.textContent = msg; },
      function(event) {
        var parts = [];
        if (event.newArticles) parts.push(event.newArticles + ' new');
        if (event.curated) parts.push(event.curated + ' curated');
        if (event.briefing) parts.push('briefing ready');
        status.textContent = parts.length > 0 ? 'Done: ' + parts.join(', ') + '.' : 'Up to date.';
        status.className = 'action-status done';
        setTimeout(function() { location.reload(); }, 1500);
      },
      function(err) {
        status.textContent = 'Error: ' + err;
        status.className = 'action-status error';
      }
    );
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.className = 'action-status error';
  } finally {
    buttons.forEach(function(b) { b.disabled = false; });
  }
}

// --- Discover Feeds (SSE + main content) ---
async function discoverFeeds() {
  var input = document.getElementById('discover-topic');
  var btn = document.getElementById('discover-btn');
  var onboardBtn = document.getElementById('onboard-search-btn');
  var results = document.getElementById('discover-results');
  var topic = input.value.trim();
  if (!topic) return;

  btn.disabled = true;
  btn.textContent = 'Searching...';
  if (onboardBtn) { onboardBtn.disabled = true; onboardBtn.textContent = 'Searching...'; }
  results.style.display = '';
  results.innerHTML = '<div class="discover-loading">Asking AI to find feeds...</div>';

  try {
    var res = await fetch('/api/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic })
    });
    var feeds = null;
    await readSSE(res,
      function(msg) {
        results.innerHTML = '<div class="discover-loading">' + escapeText(msg) + '</div>';
      },
      function(event) { feeds = event.feeds || []; },
      function(err) {
        results.innerHTML = '<div class="discover-empty">Error: ' + escapeText(err) + '</div>';
      }
    );

    if (!feeds || feeds.length === 0) {
      results.innerHTML = '<div class="discover-empty">No feeds found.</div>';
      return;
    }

    var feedItems = feeds.map(function(f, i) {
      return '<div class="discover-item" id="df-' + i + '">' +
        '<div class="discover-item-info">' +
          '<div class="discover-item-title">' + escapeText(f.title) + '</div>' +
          '<div class="discover-item-url">' + escapeText(f.url) + '</div>' +
          '<div class="discover-item-desc">' + escapeText(f.description) + '</div>' +
        '</div>' +
        '<button class="discover-add-btn" data-idx="' + i + '">Add</button>' +
      '</div>';
    }).join('');

    // Store feed data for event handlers
    window._discoverFeeds = feeds;
    window._discoverTopic = topic;

    results.innerHTML =
      '<div class="discover-header">' +
        '<h2>Feeds for \u201c' + escapeText(topic) + '\u201d</h2>' +
        '<div class="discover-actions">' +
          '<button id="register-all-btn" class="action-btn">Register All</button>' +
          '<button class="discover-close-btn">\u2715</button>' +
        '</div>' +
      '</div>' +
      '<div class="discover-list">' + feedItems + '</div>';

    // Bind events via delegation instead of inline onclick
    results.querySelectorAll('.discover-add-btn').forEach(function(b) {
      b.addEventListener('click', function() {
        var idx = Number(b.dataset.idx);
        registerFeed(idx, window._discoverFeeds[idx].url, window._discoverTopic);
      });
    });
    var regAllBtn = document.getElementById('register-all-btn');
    if (regAllBtn) regAllBtn.addEventListener('click', function() { registerAllFeeds(window._discoverTopic); });
    results.querySelector('.discover-close-btn').addEventListener('click', closeDiscoverResults);
  } catch (e) {
    results.innerHTML = '<div class="discover-empty">Error: ' + e.message + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Search';
    if (onboardBtn) { onboardBtn.disabled = false; onboardBtn.textContent = 'Search Feeds'; }
  }
}

async function registerFeed(idx, url, category) {
  var item = document.getElementById('df-' + idx);
  var btn = item.querySelector('.discover-add-btn');
  btn.disabled = true;
  btn.textContent = 'Adding...';
  var res = await fetch('/api/discover/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url, category: category })
  });
  var data = await res.json();
  btn.textContent = data.added ? 'Added!' : 'Already exists';
  btn.classList.add('done');
}

async function registerAllFeeds(topic) {
  var btn = document.getElementById('register-all-btn');
  var items = document.querySelectorAll('.discover-item');
  var toRegister = [];
  items.forEach(function(item) {
    var addBtn = item.querySelector('.discover-add-btn');
    if (!addBtn.classList.contains('done')) {
      toRegister.push({ item: item, btn: addBtn, url: item.querySelector('.discover-item-url').textContent });
    }
  });
  if (toRegister.length === 0) return;
  btn.disabled = true;
  btn.textContent = 'Registering...';
  var added = 0;
  for (var k = 0; k < toRegister.length; k++) {
    var entry = toRegister[k];
    entry.btn.disabled = true;
    entry.btn.textContent = 'Adding...';
    try {
      var res = await fetch('/api/discover/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: entry.url, category: topic })
      });
      var data = await res.json();
      entry.btn.textContent = data.added ? 'Added!' : 'Already exists';
      entry.btn.classList.add('done');
      if (data.added) added++;
    } catch (e) {
      entry.btn.textContent = 'Error';
    }
  }
  btn.textContent = added + ' feed(s) registered';
  if (added > 0) setTimeout(function() { location.reload(); }, 1000);
}

function closeDiscoverResults() {
  var results = document.getElementById('discover-results');
  results.style.display = 'none';
  results.innerHTML = '';
}

function escapeText(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Bind category/tag filter buttons via event delegation (avoid inline onclick XSS)
var catContainer = document.getElementById('category-filters');
if (catContainer) catContainer.addEventListener('click', function(e) {
  var btn = e.target.closest('.filter-btn');
  if (btn) filterByCategory(btn.dataset.value || 'all');
});
document.querySelectorAll('.tag-filters').forEach(function(container) {
  container.addEventListener('click', function(e) {
    var btn = e.target.closest('.tag-filter');
    if (btn) filterByTag(btn.dataset.value || 'all');
  });
});

// Restore filters on load
setActiveBtn('#read-filters', currentReadFilter);
setActiveBtn('#category-filters', currentCategoryFilter);
document.querySelectorAll('.tag-filter').forEach(b => {
  b.classList.toggle('active', (b.dataset.value || 'all') === currentTagFilter);
});
applyFilters();
// Hide briefing clusters where all articles are already read or dismissed
document.querySelectorAll('.briefing-cluster').forEach(function(cluster) {
  var cards = cluster.querySelectorAll('.card');
  var hasUnprocessed = false;
  cards.forEach(function(c) {
    var dismissed = c.style.display === 'none';
    var read = c.classList.contains('read');
    if (!dismissed && !read) hasUnprocessed = true;
  });
  if (!hasUnprocessed && cards.length > 0) cluster.style.display = 'none';
});

async function setAiBackend(backend) {
  var modelInput = document.getElementById('ollama-model');
  modelInput.style.display = backend === 'ollama' ? '' : 'none';
  var model = modelInput.value.trim() || 'gemma4:31b';
  await fetch('/api/config/ai-backend', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({backend: backend, model: model})
  });
}

async function setOllamaModel(model) {
  var backend = document.getElementById('ai-backend').value;
  await fetch('/api/config/ai-backend', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({backend: backend, model: model.trim()})
  });
}

async function setAutoUpdate(hours) {
  await fetch('/api/config/auto-update', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({hours: Number(hours)})
  });
}

// Request notification permission on page load
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

// Listen for auto-update events via SSE
(function() {
  var evtSource = new EventSource('/api/events');
  evtSource.addEventListener('auto-update-done', function(e) {
    var data = JSON.parse(e.data);
    if (data.newArticles > 0 || data.curated > 0) {
      var body = data.newArticles + ' new article(s), ' + data.curated + ' curated';
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Feed Curator', { body: body, icon: '/favicon.svg' });
      }
      // Reload to show new articles
      setTimeout(function() { location.reload(); }, 2000);
    }
  });
})();

// Open external links in system browser (Tauri desktop app support)
document.addEventListener('click', function(e) {
  var link = e.target.closest('a[href]');
  if (!link) return;
  var href = link.getAttribute('href');
  if (!href || href.startsWith('/') || href.startsWith('http://localhost') || href.startsWith('#')) return;
  if (!href.startsWith('http')) return;
  e.preventDefault();
  e.stopPropagation();
  // Mark as read if this is an article link
  var card = link.closest('.card');
  if (card && card.dataset.id) {
    markRead(Number(card.dataset.id));
  }
  fetch('/api/open-url', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({url: href})
  }).catch(function() {
    window.open(href, '_blank');
  });
}, true);
