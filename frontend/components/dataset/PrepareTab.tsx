"use client";

import { useEffect, useState } from "react";
import {
  CleanApplyResponse,
  CleanDetectResponse,
  CleaningOperation,
  DatasetWorkspace,
  DateOutputFormat,
  DayFirstHint,
  FilterOp,
  FilterPredicate,
  FilterResponse,
  PatternImputationResult,
  UnparseableDateRow,
} from "@/lib/api";

type MissingStrategy = "fill_mean" | "fill_median" | "fill_mode" | "drop_rows";
type PrepareSubTab = "overview" | "cleaning";

const DATE_FORMAT_LABELS: Record<DateOutputFormat, string> = {
  iso: "ISO (2024-01-08)",
  us: "US (01/08/2024)",
  eu: "EU (08/01/2024)",
};

const DAYFIRST_LABELS: Record<DayFirstHint, string> = {
  auto: "Auto-detect",
  day: "Day-first",
  month: "Month-first",
};

function getOperationLabel(op: CleaningOperation): string {
  switch (op.operation_type) {
    case "remove_all_duplicates": return "Remove duplicate rows";
    case "fill_mean": return op.column ? `Fill "${op.column}" with average` : "Fill with average";
    case "fill_median": return op.column ? `Fill "${op.column}" with median` : "Fill with median";
    case "fill_mode": return op.column ? `Fill "${op.column}" with mode` : "Fill with mode";
    case "drop_rows": return op.column ? `Drop rows missing "${op.column}"` : "Drop rows with missing";
    case "trim_whitespace": return "Trim whitespace";
    case "lowercase_column": return op.column ? `Lowercase "${op.column}"` : "Lowercase text";
    case "convert_column_type": return op.column ? `Convert "${op.column}"` : "Convert column type";
    case "standardize_dates": return op.column ? `Standardize dates in "${op.column}"` : "Standardize dates";
    case "sort_values": return op.column ? `Sort by "${op.column}" (${op.ascending === false ? "desc" : "asc"})` : "Sort data";
    case "fill_pattern": return op.column && op.key_column ? `Smart fill "${op.column}" using "${op.key_column}"` : "Smart fill";
    case "derive_column": return op.new_column_name ? `Derived column "${op.new_column_name}"` : "Derived column";
    default: return "Cleaning action";
  }
}

function getOperationDetail(op: CleaningOperation): string {
  switch (op.operation_type) {
    case "trim_whitespace": return op.columns?.length ? `Columns: ${op.columns.join(", ")}` : "All text columns";
    case "standardize_dates": {
      const fmt = op.output_format ? DATE_FORMAT_LABELS[op.output_format] : DATE_FORMAT_LABELS.iso;
      const hint = op.dayfirst_hint ? DAYFIRST_LABELS[op.dayfirst_hint] : DAYFIRST_LABELS.auto;
      return op.column ? `Format ${fmt} · ${hint}` : fmt;
    }
    case "derive_column": return op.expression ? `Formula: ${op.expression}` : "";
    case "fill_pattern": return op.key_column ? `Key: ${op.key_column}` : "";
    default: return op.columns?.length ? `Columns: ${op.columns.join(", ")}` : "";
  }
}

function getSummaryTone(label: string, value: number | string | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (label === "Missing cells") return n > 0 ? "border-yellow-200 bg-yellow-50 text-yellow-800" : "border-green-200 bg-green-50 text-green-800";
  if (label === "Duplicates") return n > 0 ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

type CellIssue = "missing" | "type_mismatch" | null;

function getCellIssue(value: unknown, colName: string, columnTypes: Record<string, string>): CellIssue {
  if (value === null || value === undefined || value === "") return "missing";
  const t = columnTypes[colName];
  if ((t === "int64" || t === "float64") && isNaN(Number(value))) return "type_mismatch";
  return null;
}

function InsightCard({ text }: { text: string }) {
  return (
    <div className="flex gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
      <span className="mt-0.5 shrink-0">ℹ️</span>
      <span className="italic">{text}</span>
    </div>
  );
}

export type PrepareTabProps = {
  workspace: DatasetWorkspace;
  subTab: PrepareSubTab;
  setSubTab: (t: PrepareSubTab) => void;
  cleaningDetection: CleanDetectResponse | null;
  cleaningDetecting: boolean;
  cleaningResult: CleanApplyResponse | null;
  cleaningOperations: CleaningOperation[];
  setCleaningOperations: React.Dispatch<React.SetStateAction<CleaningOperation[]>>;
  missingValueStrategies: Record<string, MissingStrategy>;
  setMissingValueStrategies: React.Dispatch<React.SetStateAction<Record<string, MissingStrategy>>>;
  dateFormatChoices: Record<string, DateOutputFormat>;
  setDateFormatChoices: React.Dispatch<React.SetStateAction<Record<string, DateOutputFormat>>>;
  dayfirstChoices: Record<string, DayFirstHint>;
  setDayfirstChoices: React.Dispatch<React.SetStateAction<Record<string, DayFirstHint>>>;
  overviewExtraRows: Record<string, unknown>[];
  overviewTotalRows: number | null;
  overviewLoadingMore: boolean;
  filterPredicates: FilterPredicate[];
  setFilterPredicates: React.Dispatch<React.SetStateAction<FilterPredicate[]>>;
  filterCombine: "and" | "or";
  setFilterCombine: React.Dispatch<React.SetStateAction<"and" | "or">>;
  filterPanelOpen: boolean;
  setFilterPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  filterResult: FilterResponse | null;
  filterLoading: boolean;
  draftFilterColumn: string;
  setDraftFilterColumn: React.Dispatch<React.SetStateAction<string>>;
  draftFilterOp: FilterOp;
  setDraftFilterOp: React.Dispatch<React.SetStateAction<FilterOp>>;
  draftFilterValue: string;
  setDraftFilterValue: React.Dispatch<React.SetStateAction<string>>;
  draftFilterLower: string;
  setDraftFilterLower: React.Dispatch<React.SetStateAction<string>>;
  draftFilterUpper: string;
  setDraftFilterUpper: React.Dispatch<React.SetStateAction<string>>;
  issuesPanelOpen: boolean;
  setIssuesPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  cumulativeAppliedOperations: CleaningOperation[];
  applying: boolean;
  sortColumn: string;
  setSortColumn: React.Dispatch<React.SetStateAction<string>>;
  sortAscending: boolean;
  setSortAscending: React.Dispatch<React.SetStateAction<boolean>>;
  derivedColumnName: string;
  setDerivedColumnName: React.Dispatch<React.SetStateAction<string>>;
  derivedExpression: string;
  setDerivedExpression: React.Dispatch<React.SetStateAction<string>>;
  // handlers
  handleApplyCleaning: () => void;
  handleLoadMoreOverviewRows: () => void;
  addFilterPredicate: () => void;
  removeFilterPredicate: (i: number) => void;
  clearAllFilters: () => void;
  handleRescanData: () => void;
  toggleDuplicateRows: () => void;
  toggleTrimWhitespace: () => void;
  toggleLowercaseColumn: (col: string) => void;
  toggleConvertType: (col: string, type: "numeric" | "datetime") => void;
  toggleSortValues: () => void;
  toggleStandardizeDates: (col: string) => void;
  togglePatternImputation: (target: string, key: string) => void;
  addMissingValueOperation: (col: string) => void;
  addDerivedColumn: () => void;
  hasQueuedOperation: (op: CleaningOperation) => boolean;
  getColumnType: (col: string) => string;
  isLowercaseCandidate: (type: string) => boolean;
  getDefaultMissingStrategy: (col: string) => MissingStrategy;
  buildDuplicateOperation: () => CleaningOperation;
  buildTrimWhitespaceOperation: (cols: string[]) => CleaningOperation;
  buildMissingValueOperation: (col: string, strategy: MissingStrategy) => CleaningOperation;
  buildConvertTypeOperation: (col: string, type: "numeric" | "datetime") => CleaningOperation;
  buildSortValuesOperation: (col: string, asc: boolean) => CleaningOperation;
  buildStandardizeDatesOperation: (col: string, fmt: DateOutputFormat, hint: DayFirstHint) => CleaningOperation;
  buildPatternImputationOperation: (target: string, key: string) => CleaningOperation;
};

export function PrepareTab(props: PrepareTabProps) {
  const {
    workspace, subTab, setSubTab,
    cleaningDetection, cleaningDetecting, cleaningResult, cleaningOperations, setCleaningOperations,
    missingValueStrategies, setMissingValueStrategies,
    dateFormatChoices, setDateFormatChoices,
    dayfirstChoices, setDayfirstChoices,
    overviewExtraRows, overviewTotalRows, overviewLoadingMore,
    filterPredicates, setFilterPredicates, filterCombine, setFilterCombine,
    filterPanelOpen, setFilterPanelOpen, filterResult, filterLoading,
    draftFilterColumn, setDraftFilterColumn, draftFilterOp, setDraftFilterOp,
    draftFilterValue, setDraftFilterValue, draftFilterLower, setDraftFilterLower, draftFilterUpper, setDraftFilterUpper,
    issuesPanelOpen, setIssuesPanelOpen, cumulativeAppliedOperations, applying,
    sortColumn, setSortColumn, sortAscending, setSortAscending,
    derivedColumnName, setDerivedColumnName, derivedExpression, setDerivedExpression,
    handleApplyCleaning, handleLoadMoreOverviewRows,
    addFilterPredicate, removeFilterPredicate, clearAllFilters,
    handleRescanData, toggleDuplicateRows, toggleTrimWhitespace,
    toggleLowercaseColumn, toggleConvertType, toggleSortValues,
    toggleStandardizeDates, togglePatternImputation, addMissingValueOperation, addDerivedColumn,
    hasQueuedOperation, getColumnType, isLowercaseCandidate, getDefaultMissingStrategy,
    buildDuplicateOperation, buildTrimWhitespaceOperation, buildMissingValueOperation,
    buildConvertTypeOperation, buildSortValuesOperation, buildStandardizeDatesOperation, buildPatternImputationOperation,
  } = props;

  const [expandedSmartFill, setExpandedSmartFill] = useState<Set<string>>(new Set());
  const [cleanedPreviewLimit, setCleanedPreviewLimit] = useState(10);

  useEffect(() => {
    setCleanedPreviewLimit(10);
  }, [cleaningResult]);

  const availableColumns = workspace.dataset.columns_json?.map((c) => String(c.name ?? "")).filter(Boolean) ?? [];
  const cleaningIssues = cleaningDetection?.issues ?? [];

  function renderPreviewTable(
    rows: Array<Record<string, unknown>> = workspace.dataset.preview_json ?? [],
    detectCtx?: { columnTypes: Record<string, string> } | null
  ) {
    if (rows.length === 0) return <p className="text-sm text-slate-600">No preview available.</p>;
    const cols = Object.keys(rows[0] ?? {});
    return (
      <>
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>{cols.map((c) => <th key={c} className="px-4 py-3 text-left font-medium text-slate-600">{c}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row, i) => (
                <tr key={i}>
                  {cols.map((c) => {
                    const issue = detectCtx ? getCellIssue(row[c], c, detectCtx.columnTypes) : null;
                    const cellClass = issue === "missing"
                      ? "px-4 py-3 bg-red-50 text-red-700 border-l-2 border-red-300"
                      : issue === "type_mismatch"
                      ? "px-4 py-3 bg-amber-50 text-amber-700 border-l-2 border-amber-300"
                      : "px-4 py-3 text-slate-800";
                    const cellTitle = issue === "missing"
                      ? "This cell is empty — no data here"
                      : issue === "type_mismatch"
                      ? "This value doesn't look like a number — check your data"
                      : undefined;
                    return (
                      <td key={c} className={cellClass} title={cellTitle}>
                        {issue === "missing"
                          ? <span className="italic text-xs">empty</span>
                          : String(row[c] ?? "-")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detectCtx && (
          <div className="mt-2 flex items-center gap-4 px-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-red-300 shrink-0" /> Empty cell
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-sm bg-amber-300 shrink-0" /> Wrong format
            </span>
          </div>
        )}
      </>
    );
  }

  function renderIssuesPanel() {
    if (!cleaningDetection) return null;
    const missingEntries = Object.entries(cleaningDetection.missing_values ?? {}).filter(([, count]) => count > 0);
    const typeIssues = cleaningIssues.filter((i) => i.kind === "type_inconsistency" && i.column);
    const hasDuplicates = (cleaningDetection.duplicates ?? 0) > 0;
    const totalCount = missingEntries.length + typeIssues.length + (hasDuplicates ? 1 : 0);
    if (totalCount === 0) return null;
    const rowCount = workspace.dataset.row_count ?? 0;

    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 shadow-sm">
        <button type="button" className="flex w-full items-center justify-between px-5 py-4 text-left" onClick={() => setIssuesPanelOpen((p) => !p)}>
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            <span className="font-semibold text-slate-950">{totalCount} Issue{totalCount !== 1 ? "s" : ""} Detected</span>
            <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-800">Review before applying</span>
          </div>
          <span className="text-sm text-slate-500">{issuesPanelOpen ? "▲ Collapse" : "▼ Expand"}</span>
        </button>

        {issuesPanelOpen && (
          <div className="space-y-2 border-t border-amber-200 px-5 pb-5 pt-4">
            {hasDuplicates && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <div className="text-sm text-red-800">
                  <span className="font-semibold">{cleaningDetection.duplicates} duplicate row{cleaningDetection.duplicates !== 1 ? "s" : ""}</span> found.
                </div>
                <button type="button" className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${hasQueuedOperation(buildDuplicateOperation()) ? "bg-green-100 text-green-700" : "bg-red-600 text-white hover:bg-red-500"}`} onClick={toggleDuplicateRows}>
                  {hasQueuedOperation(buildDuplicateOperation()) ? "Added" : "Add fix"}
                </button>
              </div>
            )}
            {missingEntries.map(([col, count]) => {
              const pct = rowCount > 0 ? ((count / rowCount) * 100).toFixed(1) : "0.0";
              const strategy = missingValueStrategies[col] ?? getDefaultMissingStrategy(col);
              const op = buildMissingValueOperation(col, strategy);
              const queued = hasQueuedOperation(op);
              return (
                <div key={col} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-4 py-3">
                  <div className="text-sm text-amber-900">Column <span className="font-semibold">'{col}'</span> — <span className="font-semibold">{count} missing</span> ({pct}%)</div>
                  <button type="button" className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${queued ? "bg-green-100 text-green-700" : "bg-amber-600 text-white hover:bg-amber-500"}`} onClick={() => addMissingValueOperation(col)}>
                    {queued ? "Added" : "Add fix"}
                  </button>
                </div>
              );
            })}
            {typeIssues.map((issue) => {
              const col = issue.column ?? "";
              const inferred = String(issue.details?.inferred_type ?? "");
              const target: "numeric" | "datetime" = inferred === "datetime_string" ? "datetime" : "numeric";
              const op = buildConvertTypeOperation(col, target);
              const queued = hasQueuedOperation(op);
              return (
                <div key={col} className="flex items-center justify-between gap-3 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3">
                  <div className="text-sm text-purple-900">Column <span className="font-semibold">'{col}'</span> looks like <span className="font-semibold text-purple-700">{target}</span> but is stored as text.</div>
                  <button type="button" className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${queued ? "bg-green-100 text-green-700" : "bg-purple-600 text-white hover:bg-purple-500"}`} onClick={() => toggleConvertType(col, target)}>
                    {queued ? "Added" : "Add fix"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // -- Overview sub-tab --
  const allOverviewRows = [...(workspace.dataset.preview_json ?? []), ...overviewExtraRows];
  const overviewTotal = overviewTotalRows ?? workspace.dataset.row_count ?? 0;
  const overviewLoaded = allOverviewRows.length;
  const canLoadMore = overviewLoaded < overviewTotal;
  const displayRowCount = cleaningResult?.summary.row_count ?? workspace.dataset.row_count;
  const displayColCount = cleaningResult?.summary.column_count ?? workspace.dataset.column_count;
  const displayMissing = cleaningResult?.summary.missing_cells ?? workspace.dataset.summary_json?.missing_cells;
  const displayDuplicates = cleaningResult?.summary.duplicate_rows ?? workspace.dataset.summary_json?.duplicate_rows;
  const displayPreview = cleaningResult ? cleaningResult.preview : allOverviewRows;

  const filterOps: { value: FilterOp; label: string }[] = [
    { value: "eq", label: "= equals" }, { value: "neq", label: "≠ not equal" },
    { value: "gt", label: "> greater than" }, { value: "gte", label: "≥ greater or equal" },
    { value: "lt", label: "< less than" }, { value: "lte", label: "≤ less or equal" },
    { value: "contains", label: "contains" }, { value: "starts_with", label: "starts with" },
    { value: "in", label: "in (comma list)" }, { value: "between", label: "between" },
    { value: "is_null", label: "is empty" }, { value: "not_null", label: "is not empty" },
  ];
  const opLabel = (op: FilterOp) => filterOps.find((o) => o.value === op)?.label ?? op;
  const predicateChip = (p: FilterPredicate): string => {
    if (p.op === "is_null") return `${p.column} is empty`;
    if (p.op === "not_null") return `${p.column} is not empty`;
    if (p.op === "between") return `${p.column} between ${String(p.lower)} and ${String(p.upper)}`;
    if (p.op === "in") return `${p.column} in (${(p.values ?? []).join(", ")})`;
    return `${p.column} ${opLabel(p.op).split(" ")[0]} ${String(p.value)}`;
  };
  const isUnary = draftFilterOp === "is_null" || draftFilterOp === "not_null";
  const isRange = draftFilterOp === "between";

  // -- Cleaning sub-tab --
  const duplicateCount = cleaningDetection?.duplicates ?? 0;
  const missingIssues = cleaningIssues.filter((i) => i.kind === "missing_values" && i.column);
  const textColumns = availableColumns.filter((col) => {
    const type = getColumnType(col);
    return ["text", "categorical", "numeric_string", "datetime_string"].includes(type);
  });
  const duplicateOp = buildDuplicateOperation();
  const trimOp = buildTrimWhitespaceOperation(textColumns);
  const duplicateQueued = hasQueuedOperation(duplicateOp);
  const trimQueued = hasQueuedOperation(trimOp);
  const originalRows = workspace.dataset.row_count;
  const afterRows = cleaningResult?.summary.row_count ?? originalRows;
  const rowsRemoved = typeof originalRows === "number" && typeof afterRows === "number" ? Math.max(originalRows - afterRows, 0) : 0;

  return (
    <div className="space-y-6">
      {/* Sub-tab pills */}
      <div className="flex gap-2">
        {(["overview", "cleaning"] as PrepareSubTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setSubTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${subTab === t ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"}`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "cleaning" && cleaningResult && (
              <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            )}
          </button>
        ))}
      </div>

      {subTab === "overview" && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">Rows</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">{String(displayRowCount ?? "-")}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">Columns</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">{String(displayColCount ?? "-")}</p>
            </div>
            <div className={`rounded-2xl border p-4 shadow-sm ${getSummaryTone("Missing cells", displayMissing as number | null | undefined)}`}>
              <p className="text-sm text-slate-500">Missing cells</p>
              <p className="mt-1 text-2xl font-semibold">{String(displayMissing ?? "-")}</p>
            </div>
            <div className={`rounded-2xl border p-4 shadow-sm ${getSummaryTone("Duplicates", displayDuplicates as number | null | undefined)}`}>
              <p className="text-sm text-slate-500">Duplicates</p>
              <p className="mt-1 text-2xl font-semibold">{String(displayDuplicates ?? "-")}</p>
            </div>
          </div>

          {cleaningResult ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span>Showing cleaned preview — save to make this permanent.</span>
              <button type="button" className="shrink-0 font-medium underline underline-offset-4 decoration-amber-400 hover:text-amber-900" onClick={() => setSubTab("cleaning")}>
                Go to Cleaning →
              </button>
            </div>
          ) : (() => {
            const missing = Number(workspace.dataset.summary_json?.missing_cells ?? 0);
            const dupes = Number(workspace.dataset.summary_json?.duplicate_rows ?? 0);
            if (missing === 0 && dupes === 0) return null;
            const parts: string[] = [];
            if (missing > 0) parts.push(`${missing} missing value${missing !== 1 ? "s" : ""}`);
            if (dupes > 0) parts.push(`${dupes} duplicate row${dupes !== 1 ? "s" : ""}`);
            return (
              <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">Your data has {parts.join(" and ")}.</span>
                  <button type="button" className="shrink-0 font-medium underline underline-offset-4 decoration-teal-400 hover:text-teal-900" onClick={() => setSubTab("cleaning")}>
                    Go to Cleaning →
                  </button>
                </div>
                <p className="mt-1 text-xs text-teal-700">
                  Red cells below are empty. Yellow cells have the wrong data format. Go to Cleaning to fix them.
                </p>
              </div>
            );
          })()}

          {/* Filters */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setFilterPanelOpen((o) => !o)}>
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-950">Filters</span>
                {filterPredicates.length > 0 ? (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">{filterPredicates.length} active</span>
                ) : (
                  <span className="text-xs text-slate-500">Narrow your dataset by column predicates.</span>
                )}
              </span>
              <span className="text-slate-400">{filterPanelOpen ? "▾" : "▸"}</span>
            </button>

            {filterPredicates.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {filterPredicates.map((p, i) => (
                  <span key={`${p.column}-${p.op}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                    {predicateChip(p)}
                    <button type="button" className="text-indigo-500 hover:text-indigo-900" onClick={() => removeFilterPredicate(i)} aria-label="Remove filter">×</button>
                  </span>
                ))}
                {filterPredicates.length > 1 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                    Combine:
                    <button type="button" className={`rounded-full px-2 py-0.5 ${filterCombine === "and" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"}`} onClick={() => setFilterCombine("and")}>AND</button>
                    <button type="button" className={`rounded-full px-2 py-0.5 ${filterCombine === "or" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500"}`} onClick={() => setFilterCombine("or")}>OR</button>
                  </span>
                )}
                <button type="button" className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-900 hover:underline underline-offset-4" onClick={clearAllFilters}>Clear all</button>
              </div>
            )}

            {filterPanelOpen && (
              <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,160px)_minmax(0,180px)_minmax(0,1fr)_auto]">
                <select className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500" value={draftFilterColumn} onChange={(e) => setDraftFilterColumn(e.target.value)}>
                  <option value="">Column…</option>
                  {availableColumns.map((col) => <option key={col} value={col}>{col}</option>)}
                </select>
                <select className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500" value={draftFilterOp} onChange={(e) => setDraftFilterOp(e.target.value as FilterOp)}>
                  {filterOps.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {isUnary ? (
                  <div className="self-center px-2 text-xs text-slate-500">No value needed.</div>
                ) : isRange ? (
                  <div className="flex items-center gap-2">
                    <input type="text" placeholder="lower" value={draftFilterLower} onChange={(e) => setDraftFilterLower(e.target.value)} className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500" />
                    <span className="text-xs text-slate-500">to</span>
                    <input type="text" placeholder="upper" value={draftFilterUpper} onChange={(e) => setDraftFilterUpper(e.target.value)} className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500" />
                  </div>
                ) : (
                  <input type="text" placeholder={draftFilterOp === "in" ? "value1, value2, …" : "value"} value={draftFilterValue} onChange={(e) => setDraftFilterValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFilterPredicate(); } }} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500" />
                )}
                <button type="button" className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50" onClick={addFilterPredicate} disabled={!draftFilterColumn}>Add filter</button>
              </div>
            )}

            {filterPredicates.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                {filterLoading ? "Filtering…" : filterResult
                  ? `Showing ${Math.min(filterResult.limit, filterResult.rows.length)} of ${filterResult.total_matched.toLocaleString()} matching rows.`
                  : "No filter result yet."}
              </p>
            )}
          </div>

          {/* Data table */}
          {filterPredicates.length > 0 && filterResult ? renderPreviewTable(filterResult.rows) : (
            <>
              {renderPreviewTable(
                displayPreview,
                !cleaningResult && cleaningDetection ? { columnTypes: cleaningDetection.column_types } : null
              )}
              {!cleaningResult && canLoadMore ? (
                <button onClick={handleLoadMoreOverviewRows} disabled={overviewLoadingMore} className="w-full rounded-xl border border-slate-200 bg-white py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  {overviewLoadingMore ? "Loading…" : `Load 10 more (${overviewLoaded} of ${overviewTotal} shown)`}
                </button>
              ) : !cleaningResult && overviewLoaded > 10 ? (
                <p className="text-center text-xs text-slate-400">All {overviewTotal} rows shown</p>
              ) : null}
            </>
          )}
        </div>
      )}

      {subTab === "cleaning" && (
        <div className="space-y-6">
          {cleaningDetecting ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              Detecting cleaning issues…
            </div>
          ) : (
            <>
              {/* Stats */}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm text-slate-500">Original Rows</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950">{workspace.dataset.row_count ?? "-"}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm text-slate-500">After Cleaning</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950">{String(cleaningResult?.summary.row_count ?? workspace.dataset.row_count ?? "-")}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm text-slate-500">Rows Removed</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950">{rowsRemoved}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm text-slate-500">Ops Selected</p>
                  <p className="mt-1 text-2xl font-semibold text-indigo-600">{cleaningOperations.length}</p>
                </div>
              </div>

              {/* Issue summary banner */}
              {cleaningDetection && (() => {
                const hasDupes = (cleaningDetection.duplicates ?? 0) > 0;
                const missingCount = cleaningIssues.filter((i) => i.kind === "missing_values" && i.column).length;
                const hasIssues = hasDupes || missingCount > 0;
                const parts: string[] = [];
                if (hasDupes) parts.push(`${cleaningDetection.duplicates} duplicate row${cleaningDetection.duplicates !== 1 ? "s" : ""}`);
                if (missingCount > 0) parts.push(`${missingCount} column${missingCount !== 1 ? "s" : ""} with missing values`);
                return (
                  <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${hasIssues ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"}`}>
                    <div className={`text-sm ${hasIssues ? "text-amber-800" : "text-green-800"}`}>
                      {hasIssues ? (
                        <><p className="font-medium">Issues detected — apply fixes below.</p><p className="mt-0.5 text-xs">{parts.join(", ")}</p></>
                      ) : <p className="font-medium">No issues detected — your data looks clean.</p>}
                    </div>
                    <button type="button" className={`rounded-full px-3 py-1 text-xs font-medium transition ${hasIssues ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-green-100 text-green-700 hover:bg-green-200"}`} onClick={handleRescanData}>Re-scan</button>
                  </div>
                );
              })()}

              {renderIssuesPanel()}

              {/* Operations + queue */}
              <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
                <div className="space-y-5">
                  {/* Duplicates */}
                  <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /><h3 className="text-base font-semibold text-slate-950">Duplicate Rows</h3></div>
                        <p className="mt-1 text-sm text-slate-600">{duplicateCount > 0 ? `${duplicateCount} duplicate rows found.` : "No duplicates detected."}</p>
                      </div>
                      <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">{duplicateCount > 0 ? `${duplicateCount} found` : "Clear"}</span>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div><p className="font-medium text-slate-950">Remove duplicate rows</p><p className="text-sm text-slate-600">Keep one copy of each repeated record.</p></div>
                      <button type="button" className={`rounded-full px-4 py-2 text-sm font-medium transition ${duplicateQueued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-red-600 text-white hover:bg-red-500"}`} onClick={toggleDuplicateRows}>
                        {duplicateQueued ? "Added" : "Add"}
                      </button>
                    </div>
                  </section>

                  {/* Missing Values */}
                  <section className="rounded-2xl border border-yellow-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-yellow-500" /><h3 className="text-base font-semibold text-slate-950">Missing Values</h3></div>
                        <p className="mt-1 text-sm text-slate-600">Choose a fix for each affected column.</p>
                      </div>
                      <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-700">{missingIssues.length > 0 ? `${missingIssues.length} columns` : "None detected"}</span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {missingIssues.length > 0 ? missingIssues.map((issue) => {
                        const col = issue.column ?? "";
                        const colType = getColumnType(col);
                        const strategy = missingValueStrategies[col] ?? getDefaultMissingStrategy(col);
                        const op = buildMissingValueOperation(col, strategy);
                        const queued = hasQueuedOperation(op);
                        const count = Number(issue.details?.missing_values ?? 0);
                        const pct = (workspace.dataset.row_count ?? 0) > 0 ? ((count / (workspace.dataset.row_count ?? 1)) * 100).toFixed(1) : "0.0";
                        return (
                          <div key={col} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div><p className="font-medium text-slate-950">Column: {col}</p><p className="mt-1 text-sm text-slate-600">{count} missing ({pct}%)</p></div>
                              <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-700">{colType}</span>
                            </div>
                            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                              <select className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none sm:max-w-xs" value={strategy} onChange={(e) => setMissingValueStrategies((s) => ({ ...s, [col]: e.target.value as MissingStrategy }))}>
                                <option value="fill_mean">Fill with average</option>
                                <option value="fill_median">Fill with median</option>
                                <option value="fill_mode">Fill with mode</option>
                                <option value="drop_rows">Drop rows</option>
                              </select>
                              <button type="button" className={`rounded-xl px-4 py-2 text-sm font-medium transition ${queued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-indigo-600 text-white hover:bg-indigo-500"}`} onClick={() => addMissingValueOperation(col)}>{queued ? "Added" : "Add"}</button>
                            </div>
                          </div>
                        );
                      }) : <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">No missing-value issues detected.</div>}
                    </div>
                  </section>

                  {/* Text Standardization */}
                  <section className="rounded-2xl border border-orange-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" /><h3 className="text-base font-semibold text-slate-950">Text Standardization</h3></div>
                        <p className="mt-1 text-sm text-slate-600">Quick cleanup for text columns.</p>
                      </div>
                      <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">{textColumns.length > 0 ? `${textColumns.length} columns` : "No text columns"}</span>
                    </div>
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div><p className="font-medium text-slate-950">Trim whitespace</p><p className="text-sm text-slate-600">Remove leading and trailing spaces.</p></div>
                        <button type="button" className={`rounded-full px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${trimQueued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-indigo-600 text-white hover:bg-indigo-500"}`} onClick={toggleTrimWhitespace} disabled={textColumns.length === 0}>{trimQueued ? "Added" : "Add"}</button>
                      </div>
                      {textColumns.filter((col) => isLowercaseCandidate(getColumnType(col))).map((col) => {
                        const queued = hasQueuedOperation({ operation_type: "lowercase_column", columns: [col], column: col, target_type: null, drop_all_missing: true, errors: "coerce" });
                        return (
                          <div key={col} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div><p className="font-medium text-slate-950">Lowercase {col}</p><p className="text-sm text-slate-600">Make text consistent.</p></div>
                            <button type="button" className={`rounded-full px-4 py-2 text-sm font-medium transition ${queued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-indigo-600 text-white hover:bg-indigo-500"}`} onClick={() => toggleLowercaseColumn(col)}>{queued ? "Added" : "Add"}</button>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Type Inconsistencies */}
                  {(() => {
                    const typeIssues = cleaningIssues.filter((i) => i.kind === "type_inconsistency" && i.column);
                    if (typeIssues.length === 0) return null;
                    return (
                      <section className="rounded-2xl border border-purple-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-4"><span className="h-2.5 w-2.5 rounded-full bg-purple-500" /><h3 className="text-base font-semibold text-slate-950">Type Inconsistencies</h3></div>
                        <div className="space-y-3">
                          {typeIssues.map((issue) => {
                            const col = issue.column ?? "";
                            const inferred = String(issue.details?.inferred_type ?? "");
                            const target: "numeric" | "datetime" = inferred === "datetime_string" ? "datetime" : "numeric";
                            const queued = hasQueuedOperation(buildConvertTypeOperation(col, target));
                            return (
                              <div key={col} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <div><p className="font-medium text-slate-950">{col}</p><p className="text-sm text-slate-600">Stored as text — looks like <span className="font-medium text-purple-700">{target}</span>.</p></div>
                                <button type="button" className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${queued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-purple-600 text-white hover:bg-purple-500"}`} onClick={() => toggleConvertType(col, target)}>{queued ? "Added" : `Convert to ${target}`}</button>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })()}

                  {/* Date Standardization */}
                  {(() => {
                    const dateCols = availableColumns.filter((col) => { const t = getColumnType(col); return t === "datetime" || t === "datetime_string"; });
                    if (dateCols.length === 0) return null;
                    const unparseableMap = (cleaningResult?.summary.unparseable_dates ?? {}) as Record<string, UnparseableDateRow[]>;
                    return (
                      <section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-4"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /><h3 className="text-base font-semibold text-slate-950">Date Standardization</h3></div>
                        <div className="space-y-3">
                          {dateCols.map((col) => {
                            const fmt = dateFormatChoices[col] ?? "iso";
                            const hint = dayfirstChoices[col] ?? "auto";
                            const queued = hasQueuedOperation(buildStandardizeDatesOperation(col, fmt, hint));
                            const unparseable = unparseableMap[col] ?? [];
                            return (
                              <div key={col} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <p className="font-medium text-slate-950">{col}</p>
                                  <button type="button" className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${queued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-amber-600 text-white hover:bg-amber-500"}`} onClick={() => toggleStandardizeDates(col)}>{queued ? "Added" : "Standardize"}</button>
                                </div>
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                  <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">Output format<select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none" value={fmt} onChange={(e) => setDateFormatChoices((c) => ({ ...c, [col]: e.target.value as DateOutputFormat }))}>
                                    {(["iso", "us", "eu"] as DateOutputFormat[]).map((f) => <option key={f} value={f}>{DATE_FORMAT_LABELS[f]}</option>)}
                                  </select></label>
                                  <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">Day/Month order<select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none" value={hint} onChange={(e) => setDayfirstChoices((c) => ({ ...c, [col]: e.target.value as DayFirstHint }))}>
                                    {(["auto", "day", "month"] as DayFirstHint[]).map((h) => <option key={h} value={h}>{DAYFIRST_LABELS[h]}</option>)}
                                  </select></label>
                                </div>
                                {unparseable.length > 0 && <div className="mt-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-900"><p className="font-semibold">{unparseable.length} cell{unparseable.length !== 1 ? "s" : ""} could not be parsed — original values preserved.</p></div>}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })()}

                  {/* Smart Fill */}
                  {(() => {
                    const suggestions = cleaningDetection?.pattern_suggestions ?? [];
                    if (suggestions.length === 0) return null;
                    return (
                      <section className="rounded-2xl border border-teal-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between gap-3 mb-4">
                          <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-teal-500" /><h3 className="text-base font-semibold text-slate-950">Smart Fill (Pattern Imputation)</h3></div>
                          <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-700">{suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="space-y-3">
                          {suggestions.map((s) => {
                            const op = buildPatternImputationOperation(s.target_column, s.key_column);
                            const queued = hasQueuedOperation(op);
                            const confidencePct = Math.round(s.weighted_confidence * 100);
                            const isExpanded = expandedSmartFill.has(s.target_column);
                            const topGroups = [...s.groups].sort((a, b) => b.fillable_count - a.fillable_count).slice(0, 5);
                            const extraCount = s.groups.length - topGroups.length;
                            return (
                              <div key={`${s.key_column}-${s.target_column}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="font-medium text-slate-950">Fill <span className="text-teal-700">"{s.target_column}"</span> using <span className="text-slate-700">"{s.key_column}"</span></p>
                                    <div className="mt-1 flex items-center gap-2">
                                      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-teal-500" style={{ width: `${confidencePct}%` }} /></div>
                                      <span className="text-xs font-medium text-teal-700">{confidencePct}% confidence</span>
                                    </div>
                                  </div>
                                  <button type="button" className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${queued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-teal-600 text-white hover:bg-teal-500"}`} onClick={() => togglePatternImputation(s.target_column, s.key_column)}>{queued ? "Added" : "Add"}</button>
                                </div>
                                {topGroups.length > 0 && (
                                  <div className="mt-2">
                                    <button
                                      type="button"
                                      className="text-xs text-teal-600 underline underline-offset-2 hover:text-teal-800 transition-colors"
                                      onClick={() => setExpandedSmartFill((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(s.target_column)) next.delete(s.target_column); else next.add(s.target_column);
                                        return next;
                                      })}
                                    >
                                      {isExpanded ? "Hide preview ▴" : `Show preview (${s.groups.length} group${s.groups.length !== 1 ? "s" : ""}) ▾`}
                                    </button>
                                    {isExpanded && (
                                      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                                        <table className="min-w-full text-xs">
                                          <thead className="bg-slate-100 text-slate-500">
                                            <tr>
                                              <th className="px-3 py-2 text-left font-medium">When &quot;{s.key_column}&quot; is…</th>
                                              <th className="px-3 py-2 text-left font-medium">Fill &quot;{s.target_column}&quot; with</th>
                                              <th className="px-3 py-2 text-right font-medium">Cells affected</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100 bg-white">
                                            {topGroups.map((g) => (
                                              <tr key={g.key_value}>
                                                <td className="px-3 py-1.5 font-mono text-slate-700">{g.key_value}</td>
                                                <td className="px-3 py-1.5 text-teal-700 font-medium">{g.fill_value !== null && g.fill_value !== undefined ? String(g.fill_value) : "—"}</td>
                                                <td className="px-3 py-1.5 text-right text-slate-500">{g.fillable_count}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                        {extraCount > 0 && (
                                          <p className="px-3 py-1.5 text-xs text-slate-400 bg-slate-50 text-right">+{extraCount} more group{extraCount !== 1 ? "s" : ""}</p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })()}

                  {/* Derived Column */}
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /><h3 className="text-base font-semibold text-slate-950">Derived Column</h3></div>
                    <p className="text-sm text-slate-600 mb-4">Compute a new column from a formula. Reference existing columns by name.</p>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto]">
                      <input type="text" value={derivedColumnName} onChange={(e) => setDerivedColumnName(e.target.value)} placeholder="new column name" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none" />
                      <input type="text" value={derivedExpression} onChange={(e) => setDerivedExpression(e.target.value)} placeholder="e.g. price * qty" className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-emerald-500 focus:outline-none" />
                      <button type="button" className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50" onClick={addDerivedColumn} disabled={!derivedColumnName.trim() || !derivedExpression.trim()}>Add</button>
                    </div>
                    {availableColumns.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                        <span className="text-slate-500">Columns:</span>
                        {availableColumns.slice(0, 12).map((col) => (
                          <button key={col} type="button" className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700" onClick={() => setDerivedExpression((prev) => prev ? `${prev} ${col}` : col)}>{col}</button>
                        ))}
                        {availableColumns.length > 12 && <span className="text-slate-400">+{availableColumns.length - 12} more</span>}
                      </div>
                    )}
                  </section>

                  {/* Sort Data */}
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3"><span className="h-2.5 w-2.5 rounded-full bg-slate-400" /><h3 className="text-base font-semibold text-slate-950">Sort Data</h3></div>
                    <div className="flex flex-wrap items-center gap-3">
                      <select className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none" value={sortColumn} onChange={(e) => setSortColumn(e.target.value)}>
                        {availableColumns.map((col) => <option key={col} value={col}>{col}</option>)}
                      </select>
                      <select className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none" value={sortAscending ? "asc" : "desc"} onChange={(e) => setSortAscending(e.target.value === "asc")}>
                        <option value="asc">Ascending (A→Z, 0→9)</option>
                        <option value="desc">Descending (Z→A, 9→0)</option>
                      </select>
                      {(() => {
                        const op = sortColumn ? buildSortValuesOperation(sortColumn, sortAscending) : null;
                        const queued = op ? hasQueuedOperation(op) : false;
                        return <button type="button" className={`rounded-full px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${queued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-slate-700 text-white hover:bg-slate-600"}`} onClick={toggleSortValues} disabled={!sortColumn}>{queued ? "Added" : "Add"}</button>;
                      })()}
                    </div>
                  </section>
                </div>

                {/* Operations queue */}
                <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-20 h-fit space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-slate-950">Selected Operations</h3>
                      <p className="text-sm text-slate-500">Review before applying.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">{cleaningOperations.length}</span>
                      {cleaningOperations.length > 0 && (
                        <button type="button" className="rounded-full px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600" onClick={() => setCleaningOperations([])}>Clear all</button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {cumulativeAppliedOperations.length > 0 && cleaningResult && (
                      <div className="flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5 text-xs text-teal-800">
                        <span className="mt-0.5 shrink-0">↑</span>
                        <span>Building on cleaned result — {cumulativeAppliedOperations.length} previous op{cumulativeAppliedOperations.length !== 1 ? "s" : ""} will be re-run.</span>
                      </div>
                    )}
                    {cleaningOperations.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">No operations selected yet.</div>
                    ) : (
                      cleaningOperations.map((op, i) => (
                        <div key={`${op.operation_type}-${i}`} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm shadow-sm">
                          <div>
                            <p className="font-medium text-slate-950">{getOperationLabel(op)}</p>
                            <p className="mt-1 text-xs text-slate-500">{getOperationDetail(op)}</p>
                          </div>
                          <button type="button" className="rounded-full px-2 py-1 text-sm font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-700" onClick={() => setCleaningOperations((ops) => ops.filter((_, j) => j !== i))} aria-label={`Remove ${getOperationLabel(op)}`}>×</button>
                        </div>
                      ))
                    )}
                  </div>

                  <button type="button" className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-70" onClick={handleApplyCleaning} disabled={applying || cleaningOperations.length === 0}>
                    {applying ? "Applying…" : `Apply ${cleaningOperations.length} Operation${cleaningOperations.length !== 1 ? "s" : ""}`}
                  </button>
                </aside>
              </div>

              {/* Cleaned Preview */}
              {cleaningResult && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="font-semibold text-slate-950">Cleaned Preview</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Preview the result before saving. Showing {Math.min(cleanedPreviewLimit, cleaningResult.preview.length)} of {cleaningResult.preview.length} rows.
                  </p>
                  <div className="mt-4">
                    {renderPreviewTable(cleaningResult.preview.slice(0, cleanedPreviewLimit))}
                  </div>
                  {cleaningResult.preview.length > cleanedPreviewLimit && (
                    <button
                      type="button"
                      onClick={() => setCleanedPreviewLimit((n) => Math.min(n + 20, cleaningResult.preview.length))}
                      className="mt-2 text-xs font-medium text-indigo-600 hover:underline"
                    >
                      Show {Math.min(20, cleaningResult.preview.length - cleanedPreviewLimit)} more rows ({cleaningResult.preview.length - cleanedPreviewLimit} remaining)
                    </button>
                  )}
                  <dl className="mt-4 grid grid-cols-4 gap-3 text-sm">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><dt className="text-slate-500">Rows</dt><dd className="font-medium text-slate-950">{String(cleaningResult.summary.row_count ?? "-")}</dd></div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><dt className="text-slate-500">Columns</dt><dd className="font-medium text-slate-950">{String(cleaningResult.summary.column_count ?? "-")}</dd></div>
                    <div className={`rounded-xl border p-3 ${getSummaryTone("Missing cells", Number(cleaningResult.summary.missing_cells ?? 0))}`}><dt className="text-slate-500">Missing</dt><dd className="font-medium">{String(cleaningResult.summary.missing_cells ?? "-")}</dd></div>
                    <div className={`rounded-xl border p-3 ${getSummaryTone("Duplicates", Number(cleaningResult.summary.duplicate_rows ?? 0))}`}><dt className="text-slate-500">Duplicates</dt><dd className="font-medium">{String(cleaningResult.summary.duplicate_rows ?? "-")}</dd></div>
                  </dl>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
