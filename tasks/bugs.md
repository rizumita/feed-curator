# Feed Curator Web UI - Bug Report

Date: 2026-04-02
Tested with: Chrome DevTools MCP, test DB (`data/test-ui.db`)

---

## Bug 1: Onboarding screen blocks All/Archive views when no curated articles exist (Critical)

**Location**: `src/web/html.ts:357`

**Reproduction**:
1. Register a feed and fetch articles (20 articles fetched)
2. Don't curate any articles
3. Click "All" view in sidebar

**Expected**: Articles should be listed (even if uncurated)
**Actual**: "Feeds Ready" onboarding screen is shown, blocking access to all views except "Feeds"

**Root cause**: The condition `stats.feeds > 0 && stats.curated === 0 && view !== "feeds"` blocks all views (all, archive, briefing) when `curated === 0`. Combined with `getCuratedArticles()` filtering on `curated_at IS NOT NULL` (`src/article.ts:10`), there is no way to view uncurated articles in the Web UI.

**Impact**: Users cannot browse fetched articles until AI curation runs. If curation fails or is skipped, articles are invisible.

**Fix suggestion**: 
- Change condition to only block briefing view: `stats.curated === 0 && view === "briefing"`
- Or better: add an "all articles" query that includes uncurated articles for `view=all`

---

## Bug 2: toggleRead() doesn't re-apply filters (Medium)

**Location**: `src/web/scripts.js:1-10`

**Reproduction**:
1. Open All view with "Unread only" filter active
2. Click the read checkbox on an article

**Expected**: Article disappears from the list (since "Unread only" is active)
**Actual**: Article stays visible with a checkmark, even though it's now read

**Root cause**: `toggleRead()` calls `updateUnreadCount()` but not `applyFilters()`. The read state changes visually on the card but the filter is not re-applied.

**Fix**: Add `applyFilters()` call at the end of `toggleRead()` and `markRead()`.

---

## Bug 3: Sidebar TOC section counts don't update on client-side changes (Low)

**Location**: `src/web/html.ts:203-205` (server-rendered), `src/web/scripts.js` (no update logic)

**Reproduction**:
1. Open All view with 3 curated articles across 3 tiers
2. Dismiss an article or apply a tag filter

**Expected**: TOC counts update to reflect visible articles
**Actual**: TOC still shows original counts (e.g., "Must Read 1" even after dismissing)

**Root cause**: TOC links are server-rendered and never updated by client-side JavaScript when articles are filtered or dismissed.

---

## Bug 4: `escapeAttr()` insufficient for HTML attribute context (Security - Low)

**Location**: `src/web/scripts.js:420-422`

**Description**: `escapeAttr()` escapes `\`, `'`, `"` for JavaScript string context, but is used inside HTML double-quoted `onclick` attributes. The `"` escape (`\"`) doesn't work in HTML context:

```javascript
// Input: test"onmouseover="alert(1)
// After escapeAttr: test\\"onmouseover=\\"alert(1)  
// In HTML: \\ is literal backslash, " closes the attribute → XSS
```

**Impact**: Low — only affects discover feeds feature where feed URLs are embedded in onclick handlers. Feed URLs come from AI and typically won't contain double quotes.

**Fix**: Use `data-*` attributes and event delegation instead of inline onclick with string interpolation.

---

## Minor Issues

### Default "Unread only" filter on initial load
- `scripts.js:57`: `currentReadFilter = params.get('read') || 'unread'` defaults to "unread"
- The server HTML marks "All" as the active filter button, but client JS immediately switches to "Unread only"
- Creates a brief visual inconsistency, and the server-rendered HTML active state is wrong

### URL parameter `read=unread` leaks across view switches
- `setView()` in `scripts.js:196-201` preserves all URL params including `read=unread`
- Switching from Feeds → All carries `?view=all&read=unread`
- Not harmful but clutters the URL

