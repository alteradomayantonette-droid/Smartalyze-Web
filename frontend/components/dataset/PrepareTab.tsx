"use client";

import { useEffect, useState } from "react";
import {
  CategoryStandardizationSuggestion,
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
import { AIAdvisorPanel } from "@/components/dataset/AIAdvisorPanel";

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
    case "standardize_categories": return op.column ? `Standardize values in "${op.column}"` : "Standardize values";
    case "replace_with_missing": return op.column ? `Convert disguised-missing in "${op.column}"` : "Convert disguised-missing to empty";
    case "nullify_outliers": return op.column ? `Convert outliers to empty in "${op.column}"` : "Convert outliers to empty";
    case "remove_outliers": return op.column ? `Remove outlier rows in "${op.column}"` : "Remove outlier rows";
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

function strategyLabel(s: MissingStrategy): string {
  switch (s) {
    case "fill_mean": return "Average";
    case "fill_median": return "Median";
    case "fill_mode": return "Most common value";
    case "drop_rows": return "Drop rows";
    default: return s;
  }
}

function getSummaryTone(label: string, value: number | string | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (label === "Missing cells") return n > 0 ? "border-yellow-200 bg-yellow-50 text-yellow-800" : "border-green-200 bg-green-50 text-green-800";
  if (label === "Duplicates") return n > 0 ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

type CellIssue = "missing" | "type_mismatch" | "pseudo_null" | "variant" | "outlier" | null;

const PSEUDO_NULL_TOKENS = new Set([
  "na", "n/a", "n.a", "n.a.", "not applicable", "not available",
  "none", "null", "nil", "nan", "-", "--", "---", "?", "??",
  "unknown", "unk", "missing", "tbd", "blank", "empty",
]);

type DetectContext = {
  columnTypes: Record<string, string>;
  pseudoNullCols?: Set<string>;
  outlierFences?: Record<string, { low: number; high: number }>;
  variantValues?: Record<string, Set<string>>;
  formatInconsistentCols?: Set<string>;
};

function getCellIssue(value: unknown, colName: string, ctx: DetectContext): CellIssue {
  if (value === null || value === undefined || value === "") return "missing";
  if (ctx.pseudoNullCols?.has(colName) && PSEUDO_NULL_TOKENS.has(String(value).trim().toLowerCase())) return "pseudo_null";
  if (ctx.variantValues?.[colName]?.has(String(value))) return "variant";
  const fences = ctx.outlierFences?.[colName];
  if (fences) {
    const n = Number(value);
    if (!isNaN(n) && (n < fences.low || n > fences.high)) return "outlier";
  }
  const t = ctx.columnTypes[colName];
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
  token: string | null;
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
  categoryMappingEdits: Record<string, Record<string, string>>;
  setCategoryCanonical: (col: string, suggested: string, edited: string) => void;
  toggleStandardizeCategories: (col: string, mapping: Record<string, string>) => void;
  toggleReplaceWithMissing: (col: string) => void;
  toggleRemoveOutliers: (col: string) => void;
  toggleNullifyOutliers: (col: string) => void;
  buildStandardizeCategoriesOperation: (col: string, mapping: Record<string, string>) => CleaningOperation;
  buildReplaceWithMissingOperation: (col: string) => CleaningOperation;
  buildRemoveOutliersOperation: (col: string) => CleaningOperation;
  buildNullifyOutliersOperation: (col: string) => CleaningOperation;
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
    workspace, token, subTab, setSubTab,
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
    categoryMappingEdits, setCategoryCanonical, toggleStandardizeCategories, toggleReplaceWithMissing, toggleRemoveOutliers, toggleNullifyOutliers,
    buildStandardizeCategoriesOperation, buildReplaceWithMissingOperation, buildRemoveOutliersOperation, buildNullifyOutliersOperation,
    hasQueuedOperation, getColumnType, isLowercaseCandidate, getDefaultMissingStrategy,
    buildDuplicateOperation, buildTrimWhitespaceOperation, buildMissingValueOperation,
    buildConvertTypeOperation, buildSortValuesOperation, buildStandardizeDatesOperation, buildPatternImputationOperation,
  } = props;

  const [expandedSmartFill, setExpandedSmartFill] = useState<Set<string>>(new Set());
  const [cleanedPreviewLimit, setCleanedPreviewLimit] = useState(10);
  const [dataIssuesOpen, setDataIssuesOpen] = useState(true);
  const [formattingOpen, setFormattingOpen] = useState(false);
  const [textCleanupOpen, setTextCleanupOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    setCleanedPreviewLimit(10);
  }, [cleaningResult]);

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

  const availableColumns = workspace.dataset.columns_json?.map((c) => String(c.name ?? "")).filter(Boolean) ?? [];
  const cleaningIssues = cleaningDetection?.issues ?? [];

  function renderPreviewTable(
    rows: Array<Record<string, unknown>> = workspace.dataset.preview_json ?? [],
    detectCtx?: DetectContext | null
  ) {
    if (rows.length === 0) return <p className="text-sm text-slate-600">No preview available.</p>;
    const cols = Object.keys(rows[0] ?? {});
    const formatBadgeCols = detectCtx?.formatInconsistentCols ?? new Set<string>();
    const cellStyles: Record<string, { cls: string; title: string }> = {
      missing: { cls: "px-4 py-3 bg-red-50 text-red-700 border-l-2 border-red-300", title: "This cell is empty — no data here" },
      type_mismatch: { cls: "px-4 py-3 bg-amber-50 text-amber-700 border-l-2 border-amber-300", title: "This value doesn't look like a number — check your data" },
      pseudo_null: { cls: "px-4 py-3 bg-orange-50 text-orange-700 border-l-2 border-orange-300", title: "This looks like a disguised missing value (e.g. NA) — convert it to empty in Cleaning" },
      variant: { cls: "px-4 py-3 bg-purple-50 text-purple-700 border-l-2 border-purple-300", title: "Inconsistent value — looks like a variant of another value in this column" },
      outlier: { cls: "px-4 py-3 bg-rose-50 text-rose-700 border-l-2 border-rose-300", title: "Potential outlier — far outside the typical range for this column" },
    };
    return (
      <>
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>{cols.map((c) => (
                <th key={c} className="px-4 py-3 text-left font-medium text-slate-600">
                  {c}
                  {formatBadgeCols.has(c) && (
                    <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700" title="This column mixes multiple date formats">mixed formats</span>
                  )}
                </th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row, i) => (
                <tr key={i}>
                  {cols.map((c) => {
                    const issue = detectCtx ? getCellIssue(row[c], c, detectCtx) : null;
                    const style = issue ? cellStyles[issue] : null;
                    return (
                      <td key={c} className={style?.cls ?? "px-4 py-3 text-slate-800"} title={style?.title}>
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
          <div className="mt-2 flex flex-wrap items-center gap-4 px-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-red-300 shrink-0" /> Empty cell</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-orange-300 shrink-0" /> Disguised missing</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-purple-300 shrink-0" /> Inconsistent value</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-rose-300 shrink-0" /> Outlier</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-sky-300 shrink-0" /> Mixed date formats</span>
          </div>
        )}
      </>
    );
  }

  function buildCategoryMapping(sug: CategoryStandardizationSuggestion): Record<string, string> {
    const edits = categoryMappingEdits[sug.column] ?? {};
    const mapping: Record<string, string> = {};
    for (const g of sug.groups) {
      const finalCanonical = (edits[g.canonical] ?? g.canonical).trim() || g.canonical;
      for (const member of [g.canonical, ...g.variants]) {
        if (member !== finalCanonical) mapping[member] = finalCanonical;
      }
    }
    return mapping;
  }

  function buildOverviewDetectCtx(det: CleanDetectResponse): DetectContext {
    const pseudoNullCols = new Set((det.pseudo_nulls ?? []).map((p) => p.column));
    const outlierFences: Record<string, { low: number; high: number }> = {};
    for (const o of det.outliers ?? []) outlierFences[o.column] = { low: o.lower_fence, high: o.upper_fence };
    const variantValues: Record<string, Set<string>> = {};
    for (const s of det.category_suggestions ?? []) {
      const set = new Set<string>();
      for (const g of s.groups) for (const v of g.variants) set.add(v);
      variantValues[s.column] = set;
    }
    const formatInconsistentCols = new Set(
      (det.issues ?? []).filter((i) => i.kind === "format_inconsistency" && i.column).map((i) => i.column as string)
    );
    return { columnTypes: det.column_types, pseudoNullCols, outlierFences, variantValues, formatInconsistentCols };
  }


  // -- Overview sub-tab --
  const allOverviewRows = [...(workspace.dataset.preview_json ?? []), ...overviewExtraRows];
  const overviewTotal = overviewTotalRows ?? workspace.dataset.row_count ?? 0;
  const overviewLoaded = allOverviewRows.length;
  const canLoadMore = overviewLoaded < overviewTotal;
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
  const textColumns = availableColumns.filter((col) => {
    const type = getColumnType(col);
    return ["text", "categorical", "numeric_string", "datetime_string"].includes(type);
  });
  const duplicateQueued = hasQueuedOperation(buildDuplicateOperation());
  const trimQueued = hasQueuedOperation(buildTrimWhitespaceOperation(textColumns));

  return (
    <div className="space-y-6">
      {/* Guided workflow hint */}
      <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 flex gap-3 items-start">
        <span className="text-xl shrink-0">💡</span>
        <div>
          <p className="text-sm font-semibold text-indigo-800">How to use this tab</p>
          <p className="text-sm text-indigo-700 mt-0.5">
            Browse your live data in the <strong>Data</strong> view — cells highlighted red are missing, yellow have a type problem. Switch to <strong>Clean</strong> to queue operations and apply them.
          </p>
        </div>
      </div>
      {/* Sub-tab pills */}
      <div className="flex gap-2">
        {(["overview", "cleaning"] as PrepareSubTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setSubTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${subTab === t ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"}`}
          >
            {t === "overview" ? "Data" : "Clean"}
            {t === "cleaning" && cleaningResult && (
              <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            )}
          </button>
        ))}
      </div>

      {subTab === "overview" && (
        <div className="space-y-6">
          {cleaningResult && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span>Showing cleaned preview — save to make this permanent.</span>
              <button type="button" className="shrink-0 font-medium underline underline-offset-4 decoration-amber-400 hover:text-amber-900" onClick={() => setSubTab("cleaning")}>
                Go to Clean →
              </button>
            </div>
          )}

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
                !cleaningResult && cleaningDetection ? buildOverviewDetectCtx(cleaningDetection) : null
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
