# Clean Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cluttered dual-panel Clean sub-tab with a unified AI-guided checkbox list + persistent AI chat sidebar, eliminating all duplicated "fix" buttons.

**Architecture:** The `subTab === "cleaning"` block in `PrepareTab.tsx` is fully replaced with a 2-column grid (fix checklist left, `AIAdvisorPanel` sidebar right). All existing toggle handlers and builder functions are kept — only the JSX layout changes. `AIAdvisorPanel` loses its collapse toggle so chat is always visible. `issuesPanelOpen` props are removed from the interface.

**Tech Stack:** Next.js 16, React, Tailwind CSS v4, TypeScript strict mode

---

## File Map

| File | Change |
|---|---|
| `frontend/components/dataset/AIAdvisorPanel.tsx` | Remove `chatOpen` state + toggle button; chat always visible |
| `frontend/components/dataset/PrepareTab.tsx` | Remove `issuesPanelOpen` from props; add helpers + state; replace `subTab === "cleaning"` block entirely |
| `frontend/app/dataset/[id]/page.tsx` | Remove `issuesPanelOpen` useState + prop from `<PrepareTab>` call |

---

### Task 1: Refactor AIAdvisorPanel — always-visible chat

**Files:**
- Modify: `frontend/components/dataset/AIAdvisorPanel.tsx`

- [ ] **Step 1: Remove `chatOpen` state and the toggle button**

Open `frontend/components/dataset/AIAdvisorPanel.tsx`. Delete line 57:
```ts
const [chatOpen, setChatOpen] = useState(false);
```

Replace the entire header `<div>` (lines 116–130) with:
```tsx
<div className="flex items-center gap-2 px-5 py-3 border-b border-indigo-100">
  <span className="text-sm font-semibold text-indigo-900">AI Advisor</span>
  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-600 uppercase tracking-wide">
    AI
  </span>
</div>
```

- [ ] **Step 2: Make chat panel always rendered**

Find the line `{chatOpen && (` that wraps the chat panel div. Remove that condition wrapper — replace:
```tsx
{chatOpen && (
  <div className="border-t border-indigo-100 bg-white">
```
with:
```tsx
<div className="border-t border-indigo-100 bg-white">
```
And remove the matching closing `)}` at the end of the chat panel block.

- [ ] **Step 3: Remove unused `chatOpen` from the `handleKeyDown` and `handleSendChat` references**

`chatOpen` is not referenced anywhere else in the file. Verify with a search — if clean, no further action needed.

- [ ] **Step 4: Verify TypeScript**
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**
```bash
git add frontend/components/dataset/AIAdvisorPanel.tsx
git commit -m "refactor(AIAdvisorPanel): always show chat, remove toggle button"
```

---

### Task 2: Add `strategyLabel` helper + lift issue variables + group state in PrepareTab

**Files:**
- Modify: `frontend/components/dataset/PrepareTab.tsx`

- [ ] **Step 1: Add `strategyLabel` helper function**

After the existing `getOperationDetail` function (around line 69), add:
```tsx
function strategyLabel(s: MissingStrategy): string {
  switch (s) {
    case "fill_mean": return "Average";
    case "fill_median": return "Median";
    case "fill_mode": return "Most common value";
    case "drop_rows": return "Drop rows";
    default: return s;
  }
}
```

- [ ] **Step 2: Add group-collapse state variables**

Inside `PrepareTab` function body, after the existing `const [expandedSmartFill, setExpandedSmartFill] = useState(...)` line, add:
```tsx
const [dataIssuesOpen, setDataIssuesOpen] = useState(true);
const [formattingOpen, setFormattingOpen] = useState(false);
const [textCleanupOpen, setTextCleanupOpen] = useState(false);
const [advancedOpen, setAdvancedOpen] = useState(false);
```

- [ ] **Step 3: Lift issue variables to component level**

In the `// -- Cleaning sub-tab --` section (around line 509), the current code defines `duplicateCount`, `missingIssues`, `textColumns`, etc. Add these additional variables right after `const missingIssues = ...`:

```tsx
const typeIssues = cleaningIssues.filter((i) => i.kind === "type_inconsistency" && i.column);
const formatIssues = cleaningIssues.filter((i) => i.kind === "format_inconsistency" && i.column);
const categorySuggestions = cleaningDetection?.category_suggestions ?? [];
const pseudoNullSummaries = cleaningDetection?.pseudo_nulls ?? [];
const outlierSummaries = cleaningDetection?.outliers ?? [];
const patternSuggestions = cleaningDetection?.pattern_suggestions ?? [];
const dateCols = availableColumns.filter((col) => {
  const t = getColumnType(col);
  return t === "datetime" || t === "datetime_string";
});
const unparseableMap = (cleaningResult?.summary.unparseable_dates ?? {}) as Record<string, import("@/lib/api").UnparseableDateRow[]>;
const dataIssueCount =
  (duplicateCount > 0 ? 1 : 0) +
  missingIssues.length +
  pseudoNullSummaries.length +
  patternSuggestions.length +
  outlierSummaries.length;
const formattingIssueCount = typeIssues.length + formatIssues.length + categorySuggestions.length;
const totalIssueCount = dataIssueCount + formattingIssueCount;
```

- [ ] **Step 4: Add auto-open effect for Formatting group and auto-populate effect**

After the `useEffect(() => { setCleanedPreviewLimit(10); }, [cleaningResult]);` block, add:

```tsx
// Auto-expand Formatting group when scan finds formatting issues
useEffect(() => {
  if (!cleaningDetection) return;
  const hasFormattingIssues =
    cleaningIssues.some((i) => i.kind === "type_inconsistency" && i.column) ||
    cleaningIssues.some((i) => i.kind === "format_inconsistency" && i.column) ||
    (cleaningDetection.category_suggestions?.length ?? 0) > 0;
  setFormattingOpen(hasFormattingIssues);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [cleaningDetection?.dataset_version_id]);

// Auto-populate queue with AI-recommended fixes when a new scan arrives
useEffect(() => {
  if (!cleaningDetection || cleaningOperations.length > 0) return;
  const autoOps: CleaningOperation[] = [];
  if ((cleaningDetection.duplicates ?? 0) > 0) autoOps.push(buildDuplicateOperation());
  for (const issue of cleaningIssues.filter((i) => i.kind === "missing_values" && i.column)) {
    const col = issue.column ?? "";
    autoOps.push(buildMissingValueOperation(col, getDefaultMissingStrategy(col)));
  }
  if (autoOps.length > 0) setCleaningOperations(autoOps);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [cleaningDetection?.dataset_version_id]);
```

- [ ] **Step 5: Verify TypeScript**
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 6: Commit**
```bash
git add frontend/components/dataset/PrepareTab.tsx
git commit -m "refactor(PrepareTab): add group state, lifted issue vars, auto-populate effect"
```

---

### Task 3: Remove old cleaning sub-tab blocks

**Files:**
- Modify: `frontend/components/dataset/PrepareTab.tsx`

This task removes the old structure inside `{subTab === "cleaning" && (` without adding the replacement yet. Work inside the `<>` that contains the loading check and the main content.

- [ ] **Step 1: Delete the `renderIssuesPanel` function**

Delete the entire `function renderIssuesPanel()` block (lines 330–481 in the original file). It is ~150 lines starting with `function renderIssuesPanel() {` and ending with its closing `}`.

- [ ] **Step 2: Delete the 4 stat cards block**

Inside `{subTab === "cleaning" && (`, find and delete the `{/* Stats */}` block — the `<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">` and its 4 children (Original Rows, After Cleaning, Rows Removed, Ops Selected cards). Also delete `const originalRows`, `const afterRows`, and `const rowsRemoved` since they only served those cards.

- [ ] **Step 3: Delete the issue summary banner**

Delete the IIFE block that starts with `{cleaningDetection && (() => {` and renders the amber/green "Issues detected — apply fixes below" / "No issues detected" banner. This is approximately 15 lines.

- [ ] **Step 4: Delete the `{renderIssuesPanel()}` call**

Find and delete the single line `{renderIssuesPanel()}`.

- [ ] **Step 5: Delete the `AIAdvisorPanel` mid-column block**

Delete the block:
```tsx
{cleaningDetection && token && (
  <AIAdvisorPanel
    detectResult={cleaningDetection}
    dataset={workspace.dataset}
    token={token}
  />
)}
```

- [ ] **Step 6: Delete the operations + queue grid and all its children**

Delete the entire `{/* Operations + queue */}` block — the `<div className="grid gap-6 xl:grid-cols-[1fr_320px]">` and everything inside it (all 8 section boxes + the `<aside>` operations queue). This is approximately lines 707–1016 in the original file.

At this point the `{subTab === "cleaning" && (` block should contain only:
- The loading spinner (already there)
- The `{cleaningResult && ...}` Cleaned Preview section at the bottom

- [ ] **Step 7: Verify TypeScript**
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors (unused vars from removed blocks will cause errors — fix by removing them from the `const` declarations near the top of the cleaning section: `duplicateOp`, `trimOp`, `duplicateQueued`, `trimQueued`).

Actually keep `duplicateQueued` and `trimQueued` — they will be used in Task 5. But remove `duplicateOp` and `trimOp` standalone consts since those will be inlined. Check what the compiler flags and fix accordingly.

- [ ] **Step 8: Commit**
```bash
git add frontend/components/dataset/PrepareTab.tsx
git commit -m "refactor(PrepareTab): remove old cleaning tab blocks (gutted)"
```

---

### Task 4: Build the new 2-column layout + AI strip + Data Issues group

**Files:**
- Modify: `frontend/components/dataset/PrepareTab.tsx`

Inside `{subTab === "cleaning" && (`, after the loading check and before the `{cleaningResult && ...}` preview block, insert the following. Replace the empty area with:

- [ ] **Step 1: Add the outer 2-column grid + AI strip**

```tsx
<div className="grid gap-6 xl:grid-cols-[1fr_320px]">
  {/* LEFT: Fix checklist */}
  <div className="space-y-3">

    {/* AI Summary Strip */}
    <div className="flex items-center gap-3 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-emerald-50 px-4 py-3">
      <span className="text-base shrink-0">🤖</span>
      <p className="flex-1 text-sm text-indigo-800">
        {cleaningDetection ? (
          totalIssueCount > 0 ? (
            <><strong>{totalIssueCount} issue{totalIssueCount !== 1 ? "s" : ""} found</strong> — {cleaningOperations.length} fix{cleaningOperations.length !== 1 ? "es" : ""} selected. Uncheck anything you don&apos;t want, then hit Apply.</>
          ) : (
            <strong>Your data looks clean — no issues detected.</strong>
          )
        ) : (
          "Click Re-scan to check for data issues."
        )}
      </p>
      <button type="button" onClick={handleRescanData} className="shrink-0 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 transition">
        ↻ Re-scan
      </button>
    </div>

    {/* DATA ISSUES GROUP — placeholder, filled in Step 2 */}

  </div>{/* /LEFT */}

  {/* RIGHT: AI sidebar */}
  <div className="xl:sticky xl:top-20 h-fit">
    {cleaningDetection && token && (
      <AIAdvisorPanel
        detectResult={cleaningDetection}
        dataset={workspace.dataset}
        token={token}
      />
    )}
  </div>
</div>
```

- [ ] **Step 2: Build the Data Issues collapsible group**

Replace the `{/* DATA ISSUES GROUP — placeholder */}` comment with:

```tsx
{/* Data Issues Group */}
{cleaningDetection && dataIssueCount > 0 && (
  <div className="rounded-2xl border border-red-200 bg-white overflow-hidden shadow-sm">
    <button type="button" className="flex w-full items-center gap-2 px-5 py-3.5 bg-slate-50 border-b border-slate-100 text-left hover:bg-slate-100 transition" onClick={() => setDataIssuesOpen((o) => !o)}>
      <span className="h-2.5 w-2.5 rounded-full bg-red-500 shrink-0" />
      <span className="font-semibold text-slate-950 text-sm">Data Issues</span>
      <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700 ml-1">{dataIssueCount} found</span>
      <span className="ml-auto text-slate-400 text-xs">{dataIssuesOpen ? "▾" : "▸"}</span>
    </button>

    {dataIssuesOpen && (
      <div className="divide-y divide-slate-100">

        {/* Duplicates */}
        {duplicateCount > 0 && (() => {
          const op = buildDuplicateOperation();
          const queued = hasQueuedOperation(op);
          return (
            <div className="flex items-start gap-3 px-5 py-3.5">
              <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={toggleDuplicateRows} aria-label="Toggle remove duplicates">
                {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-950">Remove {duplicateCount} duplicate row{duplicateCount !== 1 ? "s" : ""}</p>
                <p className="text-xs text-slate-500 mt-0.5">Keeps one copy of each repeated record.</p>
              </div>
              <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Critical</span>
            </div>
          );
        })()}

        {/* Missing values */}
        {missingIssues.map((issue) => {
          const col = issue.column ?? "";
          const strategy = missingValueStrategies[col] ?? getDefaultMissingStrategy(col);
          const op = buildMissingValueOperation(col, strategy);
          const queued = hasQueuedOperation(op);
          const count = Number(issue.details?.missing_values ?? 0);
          const pct = (workspace.dataset.row_count ?? 0) > 0 ? ((count / (workspace.dataset.row_count ?? 1)) * 100).toFixed(1) : "0.0";
          const aiPick = getDefaultMissingStrategy(col);
          return (
            <div key={col} className="flex items-start gap-3 px-5 py-3.5">
              <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={() => addMissingValueOperation(col)} aria-label={`Toggle fix for ${col}`}>
                {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-950">Fill <span className="text-indigo-600">&quot;{col}&quot;</span> — {count} empty cells ({pct}%)</p>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-500">Strategy:</span>
                  <select
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                    value={strategy}
                    onChange={(e) => {
                      setMissingValueStrategies((s) => ({ ...s, [col]: e.target.value as MissingStrategy }));
                    }}
                  >
                    <option value={aiPick}>🤖 {strategyLabel(aiPick)} (AI pick)</option>
                    {(["fill_mean", "fill_median", "fill_mode", "drop_rows"] as MissingStrategy[])
                      .filter((s) => s !== aiPick)
                      .map((s) => <option key={s} value={s}>{strategyLabel(s)}</option>)}
                  </select>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Missing</span>
            </div>
          );
        })}

        {/* Pseudo-nulls */}
        {pseudoNullSummaries.map((pn) => {
          const queued = hasQueuedOperation(buildReplaceWithMissingOperation(pn.column));
          return (
            <div key={`pn-${pn.column}`} className="flex items-start gap-3 px-5 py-3.5">
              <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={() => toggleReplaceWithMissing(pn.column)} aria-label={`Toggle pseudo-null fix for ${pn.column}`}>
                {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-950">Convert disguised blanks in <span className="text-indigo-600">&quot;{pn.column}&quot;</span></p>
                <p className="text-xs text-slate-500 mt-0.5">{pn.total} cells contain &quot;{Object.keys(pn.tokens).join('", "')}&quot; — treated as missing.</p>
              </div>
              <span className="shrink-0 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">Pseudo-null</span>
            </div>
          );
        })}

        {/* Smart Fill */}
        {patternSuggestions.map((s) => {
          const op = buildPatternImputationOperation(s.target_column, s.key_column);
          const queued = hasQueuedOperation(op);
          const confidencePct = Math.round(s.weighted_confidence * 100);
          const isExpanded = expandedSmartFill.has(s.target_column);
          const topGroups = [...s.groups].sort((a, b) => b.fillable_count - a.fillable_count).slice(0, 5);
          const extraCount = s.groups.length - topGroups.length;
          return (
            <div key={`sf-${s.target_column}`} className="px-5 py-3.5">
              <div className="flex items-start gap-3">
                <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-emerald-500 bg-emerald-500" : "border-slate-300 bg-white hover:border-emerald-400"}`} onClick={() => togglePatternImputation(s.target_column, s.key_column)} aria-label={`Toggle smart fill for ${s.target_column}`}>
                  {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-950">Smart fill <span className="text-emerald-600">&quot;{s.target_column}&quot;</span> using <span className="text-slate-700">&quot;{s.key_column}&quot;</span></p>
                  <p className="text-xs text-slate-500 mt-0.5">Fills empty cells using a pattern found in your data.</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-slate-200 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${confidencePct}%` }} /></div>
                    <span className="text-xs font-medium text-emerald-700">{confidencePct}% match</span>
                    {topGroups.length > 0 && (
                      <button type="button" className="text-xs text-indigo-500 hover:text-indigo-700 underline underline-offset-2 transition"
                        onClick={() => setExpandedSmartFill((prev) => { const next = new Set(prev); if (next.has(s.target_column)) next.delete(s.target_column); else next.add(s.target_column); return next; })}>
                        {isExpanded ? "Hide example ▴" : "Show example ▾"}
                      </button>
                    )}
                  </div>
                  {isExpanded && topGroups.length > 0 && (
                    <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-100 text-slate-500">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">When &quot;{s.key_column}&quot; is…</th>
                            <th className="px-3 py-2 text-left font-medium">Fill &quot;{s.target_column}&quot; with</th>
                            <th className="px-3 py-2 text-right font-medium">Cells</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {topGroups.map((g) => (
                            <tr key={g.key_value}>
                              <td className="px-3 py-1.5 font-mono text-slate-700">{g.key_value}</td>
                              <td className="px-3 py-1.5 text-emerald-700 font-medium">{g.fill_value !== null && g.fill_value !== undefined ? String(g.fill_value) : "—"}</td>
                              <td className="px-3 py-1.5 text-right text-slate-500">{g.fillable_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {extraCount > 0 && <p className="px-3 py-1.5 text-xs text-slate-400 bg-slate-50 text-right">+{extraCount} more group{extraCount !== 1 ? "s" : ""}</p>}
                    </div>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">Smart Fill</span>
              </div>
            </div>
          );
        })}

        {/* Outliers */}
        {outlierSummaries.map((o) => {
          const nullifyQueued = hasQueuedOperation(buildNullifyOutliersOperation(o.column));
          const removeQueued = hasQueuedOperation(buildRemoveOutliersOperation(o.column));
          return (
            <div key={`out-${o.column}`} className="divide-y divide-slate-100">
              <div className="flex items-start gap-3 px-5 py-3.5">
                <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${nullifyQueued ? "border-rose-500 bg-rose-500" : "border-slate-300 bg-white hover:border-rose-400"}`} onClick={() => toggleNullifyOutliers(o.column)}>
                  {nullifyQueued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-950">Blank out outliers in <span className="text-rose-600">&quot;{o.column}&quot;</span></p>
                  <p className="text-xs text-slate-500 mt-0.5">{o.outlier_count} values outside {o.lower_fence}–{o.upper_fence}. Converts them to empty (keeps rows).</p>
                </div>
                <span className="shrink-0 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-700">Outlier</span>
              </div>
              <div className="flex items-start gap-3 px-5 py-3 bg-slate-50/60">
                <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${removeQueued ? "border-rose-500 bg-rose-500" : "border-slate-300 bg-white hover:border-rose-400"}`} onClick={() => toggleRemoveOutliers(o.column)}>
                  {removeQueued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-950">Remove outlier rows in <span className="text-rose-600">&quot;{o.column}&quot;</span></p>
                  <p className="text-xs text-slate-500 mt-0.5">Drops entire rows containing these outlier values.</p>
                </div>
                <span className="shrink-0 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-700">Outlier</span>
              </div>
            </div>
          );
        })}

      </div>
    )}
  </div>
)}
```

- [ ] **Step 3: Verify TypeScript**
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**
```bash
git add frontend/components/dataset/PrepareTab.tsx
git commit -m "feat(PrepareTab): add AI strip + Data Issues fix group"
```

---

### Task 5: Build Formatting group

**Files:**
- Modify: `frontend/components/dataset/PrepareTab.tsx`

After the `{/* Data Issues Group */}` closing `)}`, add:

- [ ] **Step 1: Insert the Formatting group**

```tsx
{/* Formatting Group */}
{cleaningDetection && (
  <div className="rounded-2xl border border-purple-200 bg-white overflow-hidden shadow-sm">
    <button type="button" className="flex w-full items-center gap-2 px-5 py-3.5 bg-slate-50 border-b border-slate-100 text-left hover:bg-slate-100 transition" onClick={() => setFormattingOpen((o) => !o)}>
      <span className="h-2.5 w-2.5 rounded-full bg-purple-500 shrink-0" />
      <span className="font-semibold text-slate-950 text-sm">Formatting</span>
      {formattingIssueCount > 0
        ? <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-700 ml-1">{formattingIssueCount} found</span>
        : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 ml-1">none detected</span>}
      <span className="ml-auto text-slate-400 text-xs">{formattingOpen ? "▾" : "▸"}</span>
    </button>

    {formattingOpen && (
      <div className="divide-y divide-slate-100">

        {/* Type inconsistencies */}
        {typeIssues.map((issue) => {
          const col = issue.column ?? "";
          const inferred = String(issue.details?.inferred_type ?? "");
          const target: "numeric" | "datetime" = inferred === "datetime_string" ? "datetime" : "numeric";
          const queued = hasQueuedOperation(buildConvertTypeOperation(col, target));
          return (
            <div key={col} className="flex items-start gap-3 px-5 py-3.5">
              <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={() => toggleConvertType(col, target)}>
                {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-950">Convert <span className="text-indigo-600">&quot;{col}&quot;</span> from text → {target}</p>
                <p className="text-xs text-slate-500 mt-0.5">This column contains {target} values stored as text. AI is confident this is a mistake.</p>
              </div>
              <span className="shrink-0 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-700">Type Fix</span>
            </div>
          );
        })}

        {/* Date standardization */}
        {dateCols.map((col) => {
          const fmt = dateFormatChoices[col] ?? "iso";
          const hint = dayfirstChoices[col] ?? "auto";
          const queued = hasQueuedOperation(buildStandardizeDatesOperation(col, fmt, hint));
          const unparseable = unparseableMap[col] ?? [];
          return (
            <div key={col} className="px-5 py-3.5">
              <div className="flex items-start gap-3">
                <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={() => toggleStandardizeDates(col)}>
                  {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-950">Standardize dates in <span className="text-indigo-600">&quot;{col}&quot;</span></p>
                  <div className="mt-1.5 flex flex-wrap gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      Format
                      <select className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none" value={fmt} onChange={(e) => setDateFormatChoices((c) => ({ ...c, [col]: e.target.value as DateOutputFormat }))}>
                        {(["iso", "us", "eu"] as DateOutputFormat[]).map((f) => <option key={f} value={f}>{DATE_FORMAT_LABELS[f]}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      Order
                      <select className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none" value={hint} onChange={(e) => setDayfirstChoices((c) => ({ ...c, [col]: e.target.value as DayFirstHint }))}>
                        {(["auto", "day", "month"] as DayFirstHint[]).map((h) => <option key={h} value={h}>{DAYFIRST_LABELS[h]}</option>)}
                      </select>
                    </label>
                  </div>
                  {unparseable.length > 0 && <p className="mt-1.5 text-xs text-amber-700">{unparseable.length} cell{unparseable.length !== 1 ? "s" : ""} could not be parsed — original values preserved.</p>}
                </div>
                <span className="shrink-0 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-700">Dates</span>
              </div>
            </div>
          );
        })}

        {/* Category standardization */}
        {categorySuggestions.map((sug) => {
          const mapping = buildCategoryMapping(sug);
          const queued = hasQueuedOperation(buildStandardizeCategoriesOperation(sug.column, mapping));
          const edits = categoryMappingEdits[sug.column] ?? {};
          return (
            <div key={`cat-${sug.column}`} className="px-5 py-3.5">
              <div className="flex items-start gap-3">
                <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={() => toggleStandardizeCategories(sug.column, mapping)}>
                  {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-950">Fix inconsistent values in <span className="text-indigo-600">&quot;{sug.column}&quot;</span></p>
                  <div className="mt-2 space-y-1.5">
                    {sug.groups.map((g) => (
                      <div key={`${sug.column}-${g.canonical}`} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className="flex flex-wrap gap-1">
                          {g.variants.map((v) => (
                            <span key={v} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500 line-through">{v}</span>
                          ))}
                        </span>
                        <span className="text-slate-400">→</span>
                        <input type="text" className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-900 outline-none focus:border-indigo-500" value={edits[g.canonical] ?? g.canonical} onChange={(e) => setCategoryCanonical(sug.column, g.canonical, e.target.value)} />
                      </div>
                    ))}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-700">Categories</span>
              </div>
            </div>
          );
        })}

        {formattingIssueCount === 0 && (
          <div className="px-5 py-4 text-sm text-slate-500">No formatting issues detected.</div>
        )}

      </div>
    )}
  </div>
)}
```

- [ ] **Step 2: Verify TypeScript**
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**
```bash
git add frontend/components/dataset/PrepareTab.tsx
git commit -m "feat(PrepareTab): add Formatting fix group"
```

---

### Task 6: Build Text Cleanup + Advanced groups + sticky Apply bar

**Files:**
- Modify: `frontend/components/dataset/PrepareTab.tsx`

After the Formatting group closing `)}`, still inside the `{/* LEFT */}` div's `space-y-3`:

- [ ] **Step 1: Add Text Cleanup group (collapsed by default)**

```tsx
{/* Text Cleanup Group */}
<div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
  <button type="button" className="flex w-full items-center gap-2 px-5 py-3.5 bg-slate-50 text-left hover:bg-slate-100 transition" onClick={() => setTextCleanupOpen((o) => !o)}>
    <span className="h-2.5 w-2.5 rounded-full bg-slate-400 shrink-0" />
    <span className="font-semibold text-slate-950 text-sm">Text Cleanup</span>
    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 ml-1">optional</span>
    <span className="ml-auto text-slate-400 text-xs">{textCleanupOpen ? "▾" : "▸"}</span>
  </button>
  {textCleanupOpen && (
    <div className="divide-y divide-slate-100">
      <div className="flex items-start gap-3 px-5 py-3.5">
        <button type="button" disabled={textColumns.length === 0} className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition disabled:opacity-40 ${trimQueued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={toggleTrimWhitespace}>
          {trimQueued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-950">Trim whitespace</p>
          <p className="text-xs text-slate-500 mt-0.5">Remove leading and trailing spaces from all text columns.</p>
        </div>
      </div>
      {textColumns.filter((col) => isLowercaseCandidate(getColumnType(col))).map((col) => {
        const queued = hasQueuedOperation({ operation_type: "lowercase_column", columns: [col], column: col, target_type: null, drop_all_missing: true, errors: "coerce" });
        return (
          <div key={col} className="flex items-start gap-3 px-5 py-3.5">
            <button type="button" className={`mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${queued ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white hover:border-indigo-400"}`} onClick={() => toggleLowercaseColumn(col)}>
              {queued && <svg viewBox="0 0 12 9" className="h-2.5 w-2.5 stroke-white fill-none" strokeWidth="2.5"><polyline points="1,5 4,8 11,1"/></svg>}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-950">Lowercase <span className="text-indigo-600">&quot;{col}&quot;</span></p>
              <p className="text-xs text-slate-500 mt-0.5">Make text values consistent for comparisons.</p>
            </div>
          </div>
        );
      })}
    </div>
  )}
</div>
```

- [ ] **Step 2: Add Advanced group (collapsed by default)**

```tsx
{/* Advanced Group */}
<div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
  <button type="button" className="flex w-full items-center gap-2 px-5 py-3.5 bg-slate-50 text-left hover:bg-slate-100 transition" onClick={() => setAdvancedOpen((o) => !o)}>
    <span className="h-2.5 w-2.5 rounded-full bg-indigo-400 shrink-0" />
    <span className="font-semibold text-slate-950 text-sm">Advanced</span>
    <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-500 ml-1">Derived Column · Sort</span>
    <span className="ml-auto text-slate-400 text-xs">{advancedOpen ? "▾" : "▸"}</span>
  </button>
  {advancedOpen && (
    <div className="divide-y divide-slate-100">
      <div className="p-5">
        <p className="text-sm font-semibold text-slate-950 mb-1">Add Derived Column</p>
        <p className="text-xs text-slate-500 mb-3">Compute a new column from a formula. Reference existing columns by name.</p>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)_auto]">
          <input type="text" value={derivedColumnName} onChange={(e) => setDerivedColumnName(e.target.value)} placeholder="new column name" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none" />
          <input type="text" value={derivedExpression} onChange={(e) => setDerivedExpression(e.target.value)} placeholder="e.g. price * qty" className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none" />
          <button type="button" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50" onClick={addDerivedColumn} disabled={!derivedColumnName.trim() || !derivedExpression.trim()}>Add</button>
        </div>
        {availableColumns.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="text-xs text-slate-500 self-center">Columns:</span>
            {availableColumns.slice(0, 12).map((col) => (
              <button key={col} type="button" className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700" onClick={() => setDerivedExpression((prev) => prev ? `${prev} ${col}` : col)}>{col}</button>
            ))}
            {availableColumns.length > 12 && <span className="text-xs text-slate-400">+{availableColumns.length - 12} more</span>}
          </div>
        )}
      </div>
      <div className="p-5">
        <p className="text-sm font-semibold text-slate-950 mb-3">Sort Data</p>
        <div className="flex flex-wrap items-center gap-3">
          <select className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none" value={sortColumn} onChange={(e) => setSortColumn(e.target.value)}>
            <option value="">Column…</option>
            {availableColumns.map((col) => <option key={col} value={col}>{col}</option>)}
          </select>
          <select className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none" value={sortAscending ? "asc" : "desc"} onChange={(e) => setSortAscending(e.target.value === "asc")}>
            <option value="asc">Ascending (A→Z, 0→9)</option>
            <option value="desc">Descending (Z→A, 9→0)</option>
          </select>
          {(() => {
            const op = sortColumn ? buildSortValuesOperation(sortColumn, sortAscending) : null;
            const queued = op ? hasQueuedOperation(op) : false;
            return (
              <button type="button" className={`rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${queued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-slate-700 text-white hover:bg-slate-600"}`} onClick={toggleSortValues} disabled={!sortColumn}>
                {queued ? "Added" : "Add"}
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 3: Add sticky Apply bar (last child of the LEFT div)**

```tsx
{/* Sticky Apply bar */}
<div className="sticky bottom-0 flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white/95 backdrop-blur-sm px-5 py-4 shadow-lg">
  <p className="text-sm text-slate-600">
    {cleaningOperations.length > 0 ? (
      <><strong className="text-slate-950">{cleaningOperations.length} fix{cleaningOperations.length !== 1 ? "es" : ""}</strong> selected · Applied in safe order automatically.</>
    ) : (
      <span className="text-slate-400">No fixes selected yet.</span>
    )}
  </p>
  <button type="button" className="shrink-0 rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50" onClick={handleApplyCleaning} disabled={applying || cleaningOperations.length === 0}>
    {applying ? "Applying…" : `Apply ${cleaningOperations.length} Fix${cleaningOperations.length !== 1 ? "es" : ""}`}
  </button>
</div>
```

- [ ] **Step 4: Verify TypeScript**
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**
```bash
git add frontend/components/dataset/PrepareTab.tsx
git commit -m "feat(PrepareTab): add Text Cleanup, Advanced groups, sticky Apply bar"
```

---

### Task 7: Remove issuesPanelOpen from props + parent

**Files:**
- Modify: `frontend/components/dataset/PrepareTab.tsx`
- Modify: `frontend/app/dataset/[id]/page.tsx`

- [ ] **Step 1: Remove from PrepareTabProps interface**

In `PrepareTab.tsx`, find the `PrepareTabProps` type (around line 118). Delete these two lines:
```ts
issuesPanelOpen: boolean;
setIssuesPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
```

- [ ] **Step 2: Remove from destructure**

In the `PrepareTab` function body, find the destructure block and remove `issuesPanelOpen, setIssuesPanelOpen,` from it.

- [ ] **Step 3: Remove from page.tsx**

Open `frontend/app/dataset/[id]/page.tsx`. Find and delete the `issuesPanelOpen` useState:
```ts
const [issuesPanelOpen, setIssuesPanelOpen] = useState(false);
```

Then in the `<PrepareTab ... />` JSX, delete:
```tsx
issuesPanelOpen={issuesPanelOpen}
setIssuesPanelOpen={setIssuesPanelOpen}
```

- [ ] **Step 4: Verify TypeScript**
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**
```bash
git add frontend/components/dataset/PrepareTab.tsx frontend/app/dataset/[id]/page.tsx
git commit -m "refactor: remove issuesPanelOpen from PrepareTab props"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full TypeScript check**
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 2: Manual browser verification**

Start the dev server (`npm run dev` in `frontend/`). Open a dataset and verify:

1. Click **Clean** sub-tab → AI strip visible with issue count, Re-scan button works
2. **Data Issues** group expanded → duplicates, missing values, Smart Fill, pseudo-nulls each show as checkbox rows
3. Missing value rows have a strategy dropdown defaulting to "🤖 X (AI pick)"
4. Smart Fill row shows confidence bar + "Show example ▾" toggle
5. **Formatting** group auto-expands only when type/date/category issues exist
6. **Text Cleanup** and **Advanced** are collapsed by default
7. Unchecking a fix removes it from the selected count in the Apply bar; rechecking adds it back
8. Apply bar shows "N fixes selected" and "Apply N Fixes" button; disabled when 0 selected
9. Apply button triggers cleaning; shows "Applying…" while running
10. Cleaned preview appears below the 2-column grid after applying
11. AI sidebar shows suggestion text; chat input sends and receives replies
12. No old Issues Panel or duplicate "Add fix" buttons anywhere visible

- [ ] **Step 3: Final commit if any adjustments were needed**
```bash
git add -A
git commit -m "fix(PrepareTab): clean tab redesign polish"
```
