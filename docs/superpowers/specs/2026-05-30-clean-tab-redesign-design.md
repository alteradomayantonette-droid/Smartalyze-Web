# Clean Tab Redesign — Design Spec
**Date:** 2026-05-30  
**Status:** Approved by user

---

## Context

The "Clean" sub-tab in `PrepareTab` has grown into a cluttered, expert-facing interface. Users face:

- **Two parallel UIs for the same operations** — a collapsible Issues Panel with "Add fix" buttons, and a separate set of section cards (Duplicate Rows, Missing Values, etc.) each with their own "Add" buttons. This is confusing and redundant.
- **AI Advisor rendered as a full block** in the middle of the main flow, disconnected from the actual fix controls.
- **Smart Fill** buried inside its own section, hard to discover and compare against other issues.
- **4 stat cards** at the top (Original Rows / After Cleaning / Rows Removed / Ops Selected) that add visual noise.
- Non-technical users have no clear starting point — too many independent sections with no priority signal.

**Goal:** Collapse all of this into one unified, AI-guided checklist where AI pre-selects the best fix for each issue. Users approve or adjust, then apply.

---

## Chosen Approach: Unified Checklist + AI Chat Sidebar

Two-column layout:
- **Left (main):** AI summary strip → grouped fix checklist → sticky Apply bar
- **Right (sidebar):** AI advisor text + chat, always visible

---

## Layout & Components

### 1. AI Summary Strip (top of left column)

A single compact row:
```
🤖 AI found 4 issues — 6 fixes pre-selected based on your data. Uncheck anything you don't want, then hit Apply.    [↻ Re-scan]
```

- Replaces the issue summary banner (`hasIssues ? "Issues detected…" : "No issues detected…"`)
- Re-scan button moves here (was inside the old banner)
- Shows spinner while `cleaningDetecting` is true

### 2. Grouped Fix List

All fixes in one scrollable list, organized into collapsible groups. Each fix is a **checkbox row** — checked = queued, unchecked = skipped. The checkbox state maps directly to `cleaningOperations` (checked ↔ `hasQueuedOperation(op)`).

**Groups (in order):**

| Group | Color | Contents | Default state |
|---|---|---|---|
| Data Issues | Red | Duplicates, missing values per column, Smart Fill suggestions, pseudo-nulls | Expanded |
| Formatting | Purple | Type inconsistencies, date format standardization, category standardization | Expanded if issues |
| Text Cleanup | Gray | Trim whitespace, per-column lowercase | Collapsed |
| Advanced | Indigo | Derived Column builder, Sort Data | Collapsed |

**Fix row structure:**
```
[✓] Fix title — brief human-readable description          [BADGE]
    Strategy: [dropdown ▾]   ← only for missing values
    Confidence: ████░ 89%  "Show example ▾"  ← only for Smart Fill
```

- **Checkbox** maps to the existing toggle handlers (e.g., `toggleDuplicateRows`, `addMissingValueOperation`, `togglePatternImputation`)
- **Strategy dropdown** for missing values — shows AI's recommended option first, labeled `🤖 Median (AI pick)`, using `getDefaultMissingStrategy(col)`
- **Confidence bar + "Show example"** for Smart Fill — inline, no separate section
- **Badge** labels: Critical / Missing / Smart Fill / Type Fix / Pseudo-null / Optional

### 3. Sticky Apply Bar

Pinned to the bottom of the left column:
```
6 fixes selected · Applied in safe order automatically.        [Apply 6 Fixes →]
```

- Replaces the right-sidebar Operations Queue
- `disabled` when `cleaningOperations.length === 0 || applying`
- Shows "Applying…" while `applying === true`

### 4. AI Sidebar (right column, sticky)

Restructured `AIAdvisorPanel` or inline replacement:

**Top section — AI Suggestion:**
- Label: "🤖 AI Advisor"
- Shows `suggestion` text (up to ~4 lines, scrollable if longer)
- Spinner while `loadingSuggestion`

**Bottom section — Chat:**
- Chat message history (scrollable)
- Textarea + Send button
- Enter to send (existing behavior)

The sidebar is always visible — no "Ask a question" toggle button needed. Chat is always shown.

### 5. Cleaned Preview (below the fix list, after apply)

Kept as-is when `cleaningResult` exists:
- Preview table
- Load more button
- 4 summary stats (rows, columns, missing, duplicates)

---

## What Is Removed

| Removed element | Reason |
|---|---|
| `renderIssuesPanel()` function + its entire rendered block | Replaced by grouped fix list |
| `issuesPanelOpen` / `setIssuesPanelOpen` prop usage | No longer needed (panel gone) |
| 4 stat cards (Original Rows / After Cleaning / Rows Removed / Ops Selected) | Redundant; removed from cleaning sub-tab |
| Issue summary banner (amber/green "Issues detected — apply below") | Replaced by AI strip |
| Right-sidebar Operations Queue (`<aside>` with Selected Operations list) | Replaced by sticky apply bar + checkbox state |
| `AIAdvisorPanel` floating as a mid-column block | Moved into right sidebar |
| Separate section boxes: Duplicate Rows, Missing Values, Text Standardization, Type Inconsistencies, Date Standardization, Smart Fill, Derived Column, Sort Data | Merged into grouped fix list |

---

## What Is Kept (Unchanged)

- All toggle handlers and builder functions in props — the checkbox interactions call the same existing handlers
- `cleaningOperations` / `setCleaningOperations` as the source of truth for what's queued
- `missingValueStrategies` / `setMissingValueStrategies` — still used by the strategy dropdown
- `dateFormatChoices` / `setDateFormatChoices`, `dayfirstChoices` / `setDayfirstChoices` — still used in the Formatting group's date rows
- `categoryMappingEdits` / `setCategoryCanonical` — inline editable inputs within the Formatting group
- `derivedColumnName`, `derivedExpression`, `addDerivedColumn` — used in Advanced group
- `sortColumn`, `sortAscending` — used in Advanced group
- `expandedSmartFill` state — still controls "Show example" in Smart Fill rows
- Cleaned preview section — unchanged
- AI chat API calls in `AIAdvisorPanel` — reused; panel is refactored into sidebar only (no functional changes)

---

## Files to Modify

1. **`frontend/components/dataset/PrepareTab.tsx`** — main rewrite of the `subTab === "cleaning"` block:
   - Remove `renderIssuesPanel()` function
   - Remove 4 stat cards, issue summary banner, operations queue aside
   - Remove the `AIAdvisorPanel` block from its current position
   - Add: AI strip, grouped fix list, sticky apply bar
   - Add: 2-column grid wrapping fix list (left) + AI sidebar (right)
   - Remove `issuesPanelOpen` and `setIssuesPanelOpen` from `PrepareTabProps` interface (no longer used)

2. **`frontend/components/dataset/AIAdvisorPanel.tsx`** — layout/style changes only:
   - Remove the "Ask a question" toggle button (chat is always shown)
   - Remove the collapsible `chatOpen` state (always open)
   - Slim down padding/header to fit in the narrow sidebar
   - No logic changes

3. **`frontend/app/dataset/[id]/page.tsx`** — prop cleanup only:
   - Remove `issuesPanelOpen` state and `setIssuesPanelOpen` from the `<PrepareTab>` call site (they're no longer in the props interface)

---

## Verification

1. Open any dataset → click "Clean" sub-tab
2. AI strip shows detected issue count; Re-scan button works
3. "Data Issues" group is expanded, showing pre-checked fixes
4. Missing value rows have strategy dropdown defaulting to AI's pick
5. Smart Fill row shows confidence bar + "Show example" toggle
6. Unchecking a fix row removes it from `cleaningOperations`; rechecking re-adds it
7. "Text Cleanup" and "Advanced" groups are collapsed by default; clicking header expands them
8. Apply bar at bottom is disabled when nothing selected, enabled when ≥1 fix checked
9. Clicking Apply triggers `handleApplyCleaning`; button shows "Applying…"
10. After apply, cleaned preview appears below the fix list
11. AI sidebar shows suggestion text on load; chat input sends and receives replies
12. TypeScript `npx tsc --noEmit` passes with zero errors
