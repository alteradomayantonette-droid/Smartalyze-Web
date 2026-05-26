"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { detectCleaningIssues, getDatasetRows, saveManualEdit } from "@/lib/api";
import type { DatasetWorkspace } from "@/lib/api";
import { EditableCell } from "./EditTab/EditableCell";
import { EditToolbar } from "./EditTab/EditToolbar";

// ─── Types ────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

type EditOperation =
  | { type: "cell_edit"; rowIndex: number; colName: string; oldValue: unknown; newValue: unknown }
  | { type: "row_delete"; rowIndex: number; row: Row }
  | { type: "row_insert"; rowIndex: number }
  | { type: "col_rename"; oldName: string; newName: string }
  | { type: "bulk_suggest"; changes: Array<{ rowIndex: number; colName: string; oldValue: unknown; newValue: unknown }> };

interface SortConfig {
  col: string;
  dir: "asc" | "desc";
}

export interface EditTabProps {
  workspace: DatasetWorkspace;
  token: string;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EditTab({ workspace, token, onDirtyChange, onSaved }: EditTabProps) {
  const datasetId = workspace.dataset.id;
  const totalRows = workspace.dataset.row_count ?? 0;

  // ── Core data state ──────────────────────────────────────────────────────
  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const originalRows = useRef<Row[]>([]);
  const originalColumns = useRef<string[]>([]);

  // ── Edit tracking ────────────────────────────────────────────────────────
  const [editedCells, setEditedCells] = useState<Map<string, unknown>>(new Map());
  const [deletedRows, setDeletedRows] = useState<Set<number>>(new Set());
  const [insertedRows, setInsertedRows] = useState<Map<number, Row>>(new Map());
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  // ── Undo / redo ──────────────────────────────────────────────────────────
  const [undoStack, setUndoStack] = useState<EditOperation[]>([]);
  const [redoStack, setRedoStack] = useState<EditOperation[]>([]);

  // ── AI suggestions ───────────────────────────────────────────────────────
  const [suggestions, setSuggestions] = useState<Map<string, unknown>>(new Map());
  const [duplicateRowIndices, setDuplicateRowIndices] = useState<Set<number>>(new Set());
  const [outlierCells, setOutlierCells] = useState<Set<string>>(new Set());
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQueryRaw] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [renamingCol, setRenamingCol] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [loadingRows, setLoadingRows] = useState(true);
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 });
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Dirty detection ──────────────────────────────────────────────────────
  const isDirty = editedCells.size > 0 || deletedRows.size > 0 || insertedRows.size > 0;
  useEffect(() => { onDirtyChange(isDirty); }, [isDirty, onDirtyChange]);

  // ── Search debounce ──────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 150);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const setSearchQuery = useCallback((v: string) => setSearchQueryRaw(v), []);

  // ── Load all rows on mount ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setLoadingRows(true);
      setLoadProgress({ loaded: 0, total: totalRows });
      const PAGE = 100;
      const accumulated: Row[] = [];
      let offset = 0;
      let fetchedTotal = 0;

      try {
        while (true) {
          const res = await getDatasetRows(datasetId, offset, PAGE, token);
          if (cancelled) return;
          accumulated.push(...res.rows);
          fetchedTotal = res.total;
          setLoadProgress({ loaded: accumulated.length, total: fetchedTotal });
          if (accumulated.length >= res.total || res.rows.length === 0) break;
          offset += PAGE;
        }

        const cols = accumulated.length > 0 ? Object.keys(accumulated[0]) : [];
        setRows(accumulated);
        setColumns(cols);
        originalRows.current = accumulated.map((r) => ({ ...r }));
        originalColumns.current = [...cols];
      } catch (err) {
        if (!cancelled) setErrorMsg(String(err));
      } finally {
        if (!cancelled) setLoadingRows(false);
      }
    }
    loadAll();
    return () => { cancelled = true; };
  }, [datasetId, token, totalRows]);

  // ── Fetch AI suggestions after rows loaded ───────────────────────────────
  useEffect(() => {
    if (loadingRows || rows.length === 0) return;
    let cancelled = false;
    async function fetchSuggestions() {
      setSuggestionsLoading(true);
      try {
        const result = await detectCleaningIssues(datasetId, token);
        if (cancelled) return;

        const sugMap = new Map<string, unknown>();
        const dupSet = new Set<number>();
        const outlierSet = new Set<string>();

        // Missing value suggestions: use column mean/mode from issues
        for (const issue of result.issues) {
          if (issue.kind === "missing_values" && issue.column) {
            const colName = issue.column;
            const fillVal = issue.details?.fill_value ?? issue.details?.suggested_value ?? null;
            if (fillVal !== null && fillVal !== undefined) {
              rows.forEach((row, idx) => {
                const val = row[colName];
                if (val === null || val === undefined || val === "") {
                  sugMap.set(`${idx}::${colName}`, fillVal);
                }
              });
            }
          }
          if (issue.kind === "outlier" && issue.column) {
            rows.forEach((_, idx) => {
              outlierSet.add(`${idx}::${issue.column}`);
            });
          }
        }

        // Duplicate rows
        if (result.duplicates > 0) {
          const seen = new Map<string, number>();
          rows.forEach((row, idx) => {
            const key = JSON.stringify(row);
            if (seen.has(key)) {
              dupSet.add(idx);
            } else {
              seen.set(key, idx);
            }
          });
        }

        setSuggestions(sugMap);
        setDuplicateRowIndices(dupSet);
        setOutlierCells(outlierSet);
      } catch {
        // Suggestions are non-blocking — silently ignore errors
      } finally {
        if (!cancelled) setSuggestionsLoading(false);
      }
    }
    fetchSuggestions();
    return () => { cancelled = true; };
  }, [loadingRows, datasetId, token, rows]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); handleRedo(); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  // ── Undo / redo helpers ──────────────────────────────────────────────────
  function pushUndo(op: EditOperation) {
    setUndoStack((s) => [...s.slice(-49), op]);
    setRedoStack([]);
  }

  function handleUndo() {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const op = stack[stack.length - 1];
      applyReverse(op);
      setRedoStack((r) => [...r, op]);
      return stack.slice(0, -1);
    });
  }

  function handleRedo() {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const op = stack[stack.length - 1];
      applyForward(op);
      setUndoStack((u) => [...u, op]);
      return stack.slice(0, -1);
    });
  }

  function applyReverse(op: EditOperation) {
    if (op.type === "cell_edit") {
      setEditedCells((m) => {
        const next = new Map(m);
        const key = `${op.rowIndex}::${op.colName}`;
        if (op.oldValue === null || op.oldValue === undefined) {
          next.delete(key);
        } else {
          next.set(key, op.oldValue);
        }
        return next;
      });
    } else if (op.type === "row_delete") {
      setDeletedRows((s) => { const n = new Set(s); n.delete(op.rowIndex); return n; });
    } else if (op.type === "row_insert") {
      setInsertedRows((m) => { const n = new Map(m); n.delete(op.rowIndex); return n; });
    } else if (op.type === "col_rename") {
      renameColumnInState(op.newName, op.oldName);
    } else if (op.type === "bulk_suggest") {
      setEditedCells((m) => {
        const next = new Map(m);
        for (const c of op.changes) {
          const key = `${c.rowIndex}::${c.colName}`;
          if (c.oldValue === null || c.oldValue === undefined) { next.delete(key); }
          else { next.set(key, c.oldValue); }
        }
        return next;
      });
    }
  }

  function applyForward(op: EditOperation) {
    if (op.type === "cell_edit") {
      setEditedCells((m) => {
        const next = new Map(m);
        next.set(`${op.rowIndex}::${op.colName}`, op.newValue);
        return next;
      });
    } else if (op.type === "row_delete") {
      setDeletedRows((s) => new Set([...s, op.rowIndex]));
    } else if (op.type === "row_insert") {
      setInsertedRows((m) => {
        const blank: Row = {};
        columns.forEach((c) => { blank[c] = null; });
        return new Map([...m, [op.rowIndex, blank]]);
      });
    } else if (op.type === "col_rename") {
      renameColumnInState(op.oldName, op.newName);
    } else if (op.type === "bulk_suggest") {
      setEditedCells((m) => {
        const next = new Map(m);
        for (const c of op.changes) { next.set(`${c.rowIndex}::${c.colName}`, c.newValue); }
        return next;
      });
    }
  }

  // ── Column rename helpers ────────────────────────────────────────────────
  function renameColumnInState(oldName: string, newName: string) {
    setColumns((cols) => cols.map((c) => (c === oldName ? newName : c)));
    setRows((rs) =>
      rs.map((row) => {
        if (!(oldName in row)) return row;
        const next: Row = {};
        for (const [k, v] of Object.entries(row)) { next[k === oldName ? newName : k] = v; }
        return next;
      })
    );
    setEditedCells((m) => {
      const next = new Map<string, unknown>();
      m.forEach((v, k) => {
        const [ri, col] = k.split("::");
        next.set(`${ri}::${col === oldName ? newName : col}`, v);
      });
      return next;
    });
  }

  function commitRename() {
    if (!renamingCol) return;
    const newName = renameDraft.trim().slice(0, 100);
    if (!newName || newName === renamingCol) { setRenamingCol(null); return; }
    if (columns.includes(newName)) { setRenamingCol(null); return; }
    const op: EditOperation = { type: "col_rename", oldName: renamingCol, newName };
    renameColumnInState(renamingCol, newName);
    pushUndo(op);
    setRenamingCol(null);
  }

  // ── Cell commit ──────────────────────────────────────────────────────────
  function handleCellCommit(rowIndex: number, colName: string, newValue: unknown) {
    const key = `${rowIndex}::${colName}`;
    const oldValue = editedCells.has(key) ? editedCells.get(key) : rows[rowIndex]?.[colName] ?? insertedRows.get(rowIndex)?.[colName] ?? null;
    const op: EditOperation = { type: "cell_edit", rowIndex, colName, oldValue, newValue };

    setEditedCells((m) => {
      const next = new Map(m);
      next.set(key, newValue);
      return next;
    });
    pushUndo(op);
  }

  function handleAcceptSuggestion(rowIndex: number, colName: string, suggested: unknown) {
    handleCellCommit(rowIndex, colName, suggested);
  }

  // ── Add / delete rows ────────────────────────────────────────────────────
  function handleAddRow() {
    const newIndex = rows.length + insertedRows.size;
    const blank: Row = {};
    columns.forEach((c) => { blank[c] = null; });
    setInsertedRows((m) => new Map([...m, [newIndex, blank]]));
    pushUndo({ type: "row_insert", rowIndex: newIndex });
  }

  function handleDeleteSelected() {
    setDeletedRows((s) => new Set([...s, ...selectedRows]));
    for (const idx of selectedRows) {
      pushUndo({ type: "row_delete", rowIndex: idx, row: rows[idx] ?? {} });
    }
    setSelectedRows(new Set());
  }

  // ── Apply all suggestions ────────────────────────────────────────────────
  function handleApplyAllSuggestions() {
    const changes: Array<{ rowIndex: number; colName: string; oldValue: unknown; newValue: unknown }> = [];
    suggestions.forEach((suggested, key) => {
      const [riStr, colName] = key.split("::");
      const rowIndex = Number(riStr);
      const oldValue = editedCells.get(key) ?? rows[rowIndex]?.[colName] ?? null;
      changes.push({ rowIndex, colName, oldValue, newValue: suggested });
    });
    if (changes.length === 0) return;
    setEditedCells((m) => {
      const next = new Map(m);
      changes.forEach(({ rowIndex, colName, newValue }) => next.set(`${rowIndex}::${colName}`, newValue));
      return next;
    });
    pushUndo({ type: "bulk_suggest", changes });
  }

  // ── Cancel ───────────────────────────────────────────────────────────────
  function handleCancel() {
    setRows(originalRows.current.map((r) => ({ ...r })));
    setColumns([...originalColumns.current]);
    setEditedCells(new Map());
    setDeletedRows(new Set());
    setInsertedRows(new Map());
    setSelectedRows(new Set());
    setUndoStack([]);
    setRedoStack([]);
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    setErrorMsg(null);
    try {
      // Build final records: base rows (excluding deleted) with edits applied, then inserted rows
      const records: Row[] = [];
      rows.forEach((row, idx) => {
        if (deletedRows.has(idx)) return;
        const merged: Row = { ...row };
        columns.forEach((col) => {
          const key = `${idx}::${col}`;
          if (editedCells.has(key)) merged[col] = editedCells.get(key);
        });
        records.push(merged);
      });
      insertedRows.forEach((row) => {
        const merged: Row = { ...row };
        columns.forEach((col) => {
          const baseKey = `${rows.length + records.length - (rows.length - deletedRows.size)}::${col}`;
          if (editedCells.has(baseKey)) merged[col] = editedCells.get(baseKey);
        });
        records.push(merged);
      });

      await saveManualEdit(datasetId, { records, columns }, token);

      // Reset dirty state before reloading workspace
      setEditedCells(new Map());
      setDeletedRows(new Set());
      setInsertedRows(new Map());
      setSelectedRows(new Set());
      setUndoStack([]);
      setRedoStack([]);
      onSaved();
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setSaving(false);
    }
  }

  // ── Derived visible rows ─────────────────────────────────────────────────
  type VisibleRow = { realIndex: number; isInserted: boolean; isDeleted: boolean; data: Row };

  const visibleRows = useMemo<VisibleRow[]>(() => {
    const result: VisibleRow[] = [];

    rows.forEach((row, idx) => {
      const merged: Row = { ...row };
      columns.forEach((col) => {
        const key = `${idx}::${col}`;
        if (editedCells.has(key)) merged[col] = editedCells.get(key);
      });
      result.push({ realIndex: idx, isInserted: false, isDeleted: deletedRows.has(idx), data: merged });
    });

    insertedRows.forEach((row, idx) => {
      const merged: Row = { ...row };
      columns.forEach((col) => {
        const key = `${idx}::${col}`;
        if (editedCells.has(key)) merged[col] = editedCells.get(key);
      });
      result.push({ realIndex: idx, isInserted: true, isDeleted: false, data: merged });
    });

    // Apply search filter
    const q = debouncedSearch.toLowerCase();
    const filtered = q
      ? result.filter((r) => columns.some((col) => String(r.data[col] ?? "").toLowerCase().includes(q)))
      : result;

    // Apply sort
    if (sortConfig) {
      const { col, dir } = sortConfig;
      filtered.sort((a, b) => {
        const av = String(a.data[col] ?? "");
        const bv = String(b.data[col] ?? "");
        const n = av.localeCompare(bv, undefined, { numeric: true });
        return dir === "asc" ? n : -n;
      });
    }

    return filtered;
  }, [rows, columns, editedCells, deletedRows, insertedRows, debouncedSearch, sortConfig]);

  // ── Virtual scrolling ────────────────────────────────────────────────────
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 8,
  });

  // ── Select all ───────────────────────────────────────────────────────────
  const allVisibleIndices = visibleRows.map((r) => r.realIndex);
  const allSelected = allVisibleIndices.length > 0 && allVisibleIndices.every((i) => selectedRows.has(i));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(allVisibleIndices));
    }
  }

  function toggleSelectRow(realIndex: number) {
    setSelectedRows((s) => {
      const n = new Set(s);
      if (n.has(realIndex)) n.delete(realIndex); else n.add(realIndex);
      return n;
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loadingRows) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-sm font-medium text-slate-700">
            Loading rows… {loadProgress.loaded.toLocaleString()} / {loadProgress.total.toLocaleString()}
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: loadProgress.total > 0 ? `${(loadProgress.loaded / loadProgress.total) * 100}%` : "0%" }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-400">Editing will be available once all rows are loaded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Guidance banner */}
      <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
        <p className="text-sm font-semibold text-sky-900">Manual Dataset Editor</p>
        <p className="mt-1 text-xs text-slate-600 leading-relaxed">
          Click any cell to edit it. Double-click a column header to rename it. Use the toolbar to add rows, delete selected rows, and undo changes.{" "}
          <span className="text-slate-400">Saves create a new version — your history is preserved.</span>
        </p>
      </div>

      {suggestionsLoading && (
        <p className="text-xs text-slate-400 px-1">✨ Loading AI suggestions…</p>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {isDirty && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span>⚠</span>
          <span>You have unsaved changes.</span>
        </div>
      )}

      <EditToolbar
        columns={columns}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        sortConfig={sortConfig}
        setSortConfig={setSortConfig}
        onAddRow={handleAddRow}
        selectedRows={selectedRows}
        onDeleteSelected={handleDeleteSelected}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onApplyAllSuggestions={handleApplyAllSuggestions}
        suggestionCount={suggestions.size}
        isDirty={isDirty}
        onSave={handleSave}
        onCancel={handleCancel}
        saving={saving}
      />

      {/* Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Sticky header */}
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr>
                {/* Checkbox column */}
                <th className="w-10 border-b border-slate-200 px-3 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                  />
                </th>
                {/* Row number */}
                <th className="w-12 border-b border-slate-200 px-3 py-3 text-left text-xs font-medium text-slate-400">#</th>
                {/* Data columns */}
                {columns.map((col) => (
                  <th
                    key={col}
                    className="border-b border-slate-200 px-3 py-3 text-left text-xs font-semibold text-slate-600 whitespace-nowrap"
                  >
                    {renamingCol === col ? (
                      <input
                        autoFocus
                        className="w-32 rounded border border-indigo-400 bg-white px-2 py-0.5 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-indigo-300"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setRenamingCol(null);
                        }}
                      />
                    ) : (
                      <span
                        onDoubleClick={() => { setRenamingCol(col); setRenameDraft(col); }}
                        title="Double-click to rename"
                        className="cursor-pointer hover:text-indigo-600 transition-colors"
                      >
                        {col}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>

        {/* Virtualised body */}
        <div ref={parentRef} className="overflow-auto" style={{ maxHeight: "520px" }}>
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const vRow = visibleRows[vItem.index];
              if (!vRow) return null;
              const { realIndex, isInserted, isDeleted, data } = vRow;
              const isSelected = selectedRows.has(realIndex);
              const isDuplicate = duplicateRowIndices.has(realIndex);

              let rowClass = "flex border-b border-slate-100 transition-colors";
              if (isDeleted) rowClass += " opacity-40 line-through bg-red-50";
              else if (isSelected) rowClass += " bg-indigo-50/60";
              else if (isDuplicate) rowClass += " bg-amber-50/60";
              else rowClass += " hover:bg-slate-50/60";

              return (
                <div
                  key={vItem.key}
                  style={{ position: "absolute", top: `${vItem.start}px`, left: 0, right: 0, height: `${vItem.size}px` }}
                >
                  <table className="min-w-full border-collapse">
                    <tbody>
                      <tr className={rowClass}>
                        {/* Checkbox */}
                        <td className="w-10 px-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectRow(realIndex)}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
                          />
                        </td>
                        {/* Row number */}
                        <td className="w-12 px-3 text-xs text-slate-400 select-none">
                          {isInserted ? (
                            <span className="rounded bg-green-100 px-1 text-green-700 text-xs">new</span>
                          ) : (
                            realIndex + 1
                          )}
                          {isDuplicate && (
                            <span className="ml-1 rounded bg-amber-100 px-1 text-amber-700 text-xs">dup</span>
                          )}
                        </td>
                        {/* Data cells */}
                        {columns.map((col) => {
                          const key = `${realIndex}::${col}`;
                          const cellVal = data[col];
                          const isMissing = cellVal === null || cellVal === undefined || cellVal === "";
                          const isDirtyCel = editedCells.has(key);
                          const suggestion = suggestions.get(key);
                          const isOutlier = outlierCells.has(key);

                          return (
                            <td
                              key={col}
                              className="min-w-30 max-w-65 border-r border-slate-100 last:border-r-0 p-0"
                            >
                              {!isDeleted && (
                                <EditableCell
                                  value={cellVal}
                                  rowIndex={realIndex}
                                  colName={col}
                                  isDirty={isDirtyCel}
                                  isMissing={isMissing}
                                  isDuplicate={isDuplicate}
                                  isOutlier={isOutlier}
                                  suggestion={suggestion}
                                  onCommit={handleCellCommit}
                                  onAcceptSuggestion={handleAcceptSuggestion}
                                />
                              )}
                              {isDeleted && (
                                <span className="px-3 py-2 text-sm text-slate-400">{String(cellVal ?? "")}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>

        {visibleRows.length === 0 && !loadingRows && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            {debouncedSearch ? "No rows match your search." : "No rows in this dataset."}
          </div>
        )}
      </div>

      {/* Footer summary */}
      <p className="text-xs text-slate-400 px-1">
        {visibleRows.length.toLocaleString()} rows shown
        {debouncedSearch && ` (filtered from ${rows.length + insertedRows.size})`}
        {deletedRows.size > 0 && ` · ${deletedRows.size} marked for deletion`}
        {insertedRows.size > 0 && ` · ${insertedRows.size} new row${insertedRows.size > 1 ? "s" : ""}`}
        {editedCells.size > 0 && ` · ${editedCells.size} edited cell${editedCells.size > 1 ? "s" : ""}`}
      </p>
    </div>
  );
}
