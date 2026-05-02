"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  analyzeStats,
  AnalyzeStatsResponse,
  AnomalyResponse,
  applyCleaningOperations,
  CleaningOperation,
  CleanApplyResponse,
  CleanDetectResponse,
  DatasetWorkspace,
  detectCleaningIssues,
  exportDataset,
  ExportDatasetFormat,
  getAnomalies,
  getDatasetWorkspace,
  getTrends,
  groupDataset,
  GroupByResponse,
  predictDataset,
  PredictResponse,
  saveDatasetResult,
  TrendResponse,
  uploadDataset,
} from "@/lib/api";
import { clearStoredToken, getStoredToken } from "@/lib/auth";

type WorkspaceTab = "overview" | "cleaning" | "analysis" | "aggregation" | "trends" | "anomaly" | "prediction";
type FeedbackTone = "neutral" | "success" | "warning" | "error";
type MissingStrategy = "fill_mean" | "fill_median" | "fill_mode" | "drop_rows";

function getFeedbackClasses(tone: FeedbackTone): string {
  switch (tone) {
    case "success":
      return "border-green-200 bg-green-50 text-green-800";
    case "warning":
      return "border-yellow-200 bg-yellow-50 text-yellow-800";
    case "error":
      return "border-red-200 bg-red-50 text-red-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function getSummaryTone(label: string, value: number | string | null | undefined): string {
  const numericValue = typeof value === "number" ? value : Number(value ?? 0);

  if (label === "Missing cells") {
    return numericValue > 0 ? "border-yellow-200 bg-yellow-50 text-yellow-800" : "border-green-200 bg-green-50 text-green-800";
  }

  if (label === "Duplicates") {
    return numericValue > 0 ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function getColumnType(columnName: string, detection: CleanDetectResponse | null): string {
  return detection?.column_types?.[columnName] ?? "unknown";
}

function isTextLikeColumnType(columnType: string): boolean {
  return ["text", "categorical", "numeric_string", "datetime_string"].includes(columnType);
}

function isLowercaseCandidate(columnType: string): boolean {
  return ["text", "categorical"].includes(columnType);
}

function getTextColumns(detection: CleanDetectResponse | null, availableColumns: string[]): string[] {
  return availableColumns.filter((columnName) => isTextLikeColumnType(getColumnType(columnName, detection)));
}

function getDefaultMissingStrategy(columnName: string, detection: CleanDetectResponse | null): MissingStrategy {
  const columnType = getColumnType(columnName, detection);
  return columnType === "numeric" || columnType === "numeric_string" ? "fill_median" : "fill_mode";
}

function buildDuplicateOperation(): CleaningOperation {
  return {
    operation_type: "remove_all_duplicates",
    columns: [],
    column: null,
    target_type: null,
    drop_all_missing: true,
    errors: "coerce",
  };
}

function buildMissingValueOperation(columnName: string, strategy: MissingStrategy): CleaningOperation {
  return {
    operation_type: strategy,
    columns: [columnName],
    column: columnName,
    target_type: null,
    drop_all_missing: true,
    errors: "coerce",
  };
}

function buildTrimWhitespaceOperation(columns: string[]): CleaningOperation {
  return {
    operation_type: "trim_whitespace",
    columns,
    column: null,
    target_type: null,
    drop_all_missing: true,
    errors: "coerce",
  };
}

function buildConvertTypeOperation(columnName: string, targetType: "numeric" | "datetime"): CleaningOperation {
  return {
    operation_type: "convert_column_type",
    column: columnName,
    target_type: targetType,
    errors: "coerce",
  };
}

function buildLowercaseOperation(columnName: string): CleaningOperation {
  return {
    operation_type: "lowercase_column",
    columns: [columnName],
    column: columnName,
    target_type: null,
    drop_all_missing: true,
    errors: "coerce",
  };
}

function getOperationLabel(operation: CleaningOperation): string {
  switch (operation.operation_type) {
    case "remove_all_duplicates":
      return "Remove duplicate rows";
    case "fill_mean":
      return operation.column ? `Fill "${operation.column}" missing values with average` : "Fill missing values with average";
    case "fill_median":
      return operation.column ? `Fill "${operation.column}" missing values with median` : "Fill missing values with median";
    case "fill_mode":
      return operation.column ? `Fill "${operation.column}" missing values with mode` : "Fill missing values with mode";
    case "drop_rows":
      return operation.column ? `Drop rows with missing values in "${operation.column}"` : "Drop rows with missing values";
    case "trim_whitespace":
      return "Trim whitespace";
    case "lowercase_column":
      return operation.column ? `Lowercase "${operation.column}"` : "Lowercase text";
    case "convert_column_type":
      return operation.column ? `Convert "${operation.column}"` : "Convert column type";
    default:
      return "Cleaning action";
  }
}

function getOperationDetail(operation: CleaningOperation): string {
  switch (operation.operation_type) {
    case "remove_all_duplicates":
      return "Applies to the full dataset.";
    case "trim_whitespace":
      return operation.columns?.length ? `Columns: ${operation.columns.join(", ")}` : "Applied to detected text columns.";
    case "lowercase_column":
      return operation.column ? `Column: ${operation.column}` : "Lowercase a text column.";
    case "convert_column_type":
      return operation.column ? `Column: ${operation.column}` : "Convert a column to another type.";
    default:
      return operation.columns?.length ? `Columns: ${operation.columns.join(", ")}` : "";
  }
}

function areCleaningOperationsEqual(left: CleaningOperation, right: CleaningOperation): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildSnapshotFromDataset(dataset: DatasetWorkspace["dataset"]): Record<string, unknown> {
  const summary = (dataset.summary_json ?? {}) as Record<string, unknown>;

  return {
    source_name: dataset.original_filename,
    file_type: dataset.file_format,
    size_bytes: dataset.size_bytes,
    records: dataset.preview_json ?? [],
    columns: dataset.columns_json ?? [],
    preview: dataset.preview_json ?? [],
    summary: dataset.summary_json ?? {
      row_count: dataset.row_count ?? 0,
      column_count: dataset.column_count ?? 0,
      missing_cells: Number(summary.missing_cells ?? 0),
      duplicate_rows: Number(summary.duplicate_rows ?? 0),
      size_bytes: dataset.size_bytes,
    },
  };
}


export default function DatasetWorkspacePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const datasetId = Number(params.id);

  const [workspace, setWorkspace] = useState<DatasetWorkspace | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [token, setToken] = useState<string | null>(null);
  const [aggregationGroupBy, setAggregationGroupBy] = useState("");
  const [aggregationOperation, setAggregationOperation] = useState("sum");
  const [predictionInputColumn, setPredictionInputColumn] = useState("");
  const [predictionTargetColumn, setPredictionTargetColumn] = useState("");
  const [predictionSteps, setPredictionSteps] = useState(5);
  const [predictionResult, setPredictionResult] = useState<PredictResponse | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveMode, setSaveMode] = useState<"replace" | "new">("replace");
  const [newDatasetName, setNewDatasetName] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<FeedbackTone>("neutral");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportDatasetFormat>("csv");
  const [exporting, setExporting] = useState(false);
  const [cleaningDetection, setCleaningDetection] = useState<CleanDetectResponse | null>(null);
  const [cleaningDetecting, setCleaningDetecting] = useState(false);
  const [cleaningOperations, setCleaningOperations] = useState<CleaningOperation[]>([]);
  const [cleaningResult, setCleaningResult] = useState<CleanApplyResponse | null>(null);
  const [missingValueStrategies, setMissingValueStrategies] = useState<Record<string, MissingStrategy>>({});
  const [analysisStats, setAnalysisStats] = useState<AnalyzeStatsResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [aggregateColumn, setAggregateColumn] = useState("");
  const [groupResult, setGroupResult] = useState<GroupByResponse | null>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [saveGroupAsOpen, setSaveGroupAsOpen] = useState(false);
  const [saveGroupAsName, setSaveGroupAsName] = useState("");
  const [saveGroupAsSaving, setSaveGroupAsSaving] = useState(false);
  const [trendData, setTrendData] = useState<TrendResponse | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [selectedTrendColumn, setSelectedTrendColumn] = useState("");
  const [anomalyData, setAnomalyData] = useState<AnomalyResponse | null>(null);
  const [anomalyLoading, setAnomalyLoading] = useState(false);

  function setFeedback(text: string, tone: FeedbackTone = "neutral") {
    setMessage(text);
    setMessageTone(tone);
  }

  useEffect(() => {
    const storedToken = getStoredToken();
    if (!storedToken) {
      router.replace("/login");
      return;
    }

    setToken(storedToken);

    if (!Number.isFinite(datasetId)) {
      router.replace("/dashboard");
      return;
    }

    getDatasetWorkspace(datasetId, storedToken)
      .then((ws) => {
        setWorkspace(ws);
        const firstCol = ws.dataset.columns_json?.[0];
        const firstName = firstCol ? String(firstCol.name ?? "") : "";
        if (firstName) {
          setAggregationGroupBy(firstName);
          setAggregateColumn(firstName);
          setPredictionInputColumn(firstName);
          setPredictionTargetColumn(firstName);
        }
      })
      .catch(() => {
        clearStoredToken();
        router.replace("/login");
      })
      .finally(() => setLoading(false));
  }, [datasetId, router]);

  useEffect(() => {
    if (activeTab !== "trends" || !workspace || !token || trendData) return;
    setTrendLoading(true);
    getTrends(workspace.dataset.id, token)
      .then((data) => {
        setTrendData(data);
        if (data.columns[0]) setSelectedTrendColumn(data.columns[0].column);
      })
      .catch(() => { setMessage("Could not load trend data."); setMessageTone("error"); })
      .finally(() => setTrendLoading(false));
  }, [activeTab, workspace, token, trendData]);

  useEffect(() => {
    if (activeTab !== "anomaly" || !workspace || !token || anomalyData) return;
    setAnomalyLoading(true);
    getAnomalies(workspace.dataset.id, token)
      .then(setAnomalyData)
      .catch(() => { setMessage("Could not load anomaly data."); setMessageTone("error"); })
      .finally(() => setAnomalyLoading(false));
  }, [activeTab, workspace, token, anomalyData]);

  useEffect(() => {
    if (activeTab !== "analysis" || !workspace || !token || analysisStats) return;
    setAnalysisLoading(true);
    analyzeStats(workspace.dataset.id, token)
      .then(setAnalysisStats)
      .catch(() => {
        setMessage("Could not load column statistics.");
        setMessageTone("error");
      })
      .finally(() => setAnalysisLoading(false));
  }, [activeTab, workspace, token, analysisStats]);

  useEffect(() => {
    if (activeTab !== "cleaning" || !workspace || !token || cleaningDetection) return;
    setCleaningDetecting(true);
    detectCleaningIssues(workspace.dataset.id, token)
      .then(setCleaningDetection)
      .catch(() => setFeedback("Could not detect cleaning issues.", "error"))
      .finally(() => setCleaningDetecting(false));
  }, [activeTab, workspace, token, cleaningDetection]);

  const availableColumns = workspace?.dataset.columns_json?.map((column) => String(column.name ?? "")).filter(Boolean) ?? [];
  const cleaningIssues = cleaningDetection?.issues ?? [];

  function getSourceVersionId(): number | null {
    return cleaningDetection?.dataset_version_id ?? null;
  }

  function hasQueuedOperation(operation: CleaningOperation): boolean {
    return cleaningOperations.some((currentOperation) => areCleaningOperationsEqual(currentOperation, operation));
  }

  function toggleOperation(operation: CleaningOperation, addMessage: string, removeMessage: string) {
    setCleaningOperations((currentOperations) => {
      const exists = currentOperations.some((currentOperation) => areCleaningOperationsEqual(currentOperation, operation));
      if (exists) {
        setFeedback(removeMessage, "warning");
        return currentOperations.filter((currentOperation) => !areCleaningOperationsEqual(currentOperation, operation));
      }

      setFeedback(addMessage, "success");
      return [...currentOperations, operation];
    });
  }

  function addMissingValueOperation(columnName: string) {
    const strategy = missingValueStrategies[columnName] ?? getDefaultMissingStrategy(columnName, cleaningDetection);
    const operation = buildMissingValueOperation(columnName, strategy);
    toggleOperation(operation, `Added ${getOperationLabel(operation)}.`, `Removed ${getOperationLabel(operation)} from the queue.`);
  }

  function toggleDuplicateRows() {
    const operation = buildDuplicateOperation();
    toggleOperation(operation, "Added remove duplicate rows.", "Removed duplicate rows from the queue.");
  }

  function toggleTrimWhitespace() {
    const textColumns = getTextColumns(cleaningDetection, availableColumns);
    if (textColumns.length === 0) {
      setFeedback("No text columns were found for trimming.", "warning");
      return;
    }

    const operation = buildTrimWhitespaceOperation(textColumns);
    toggleOperation(operation, "Added trim whitespace.", "Removed trim whitespace from the queue.");
  }

  function toggleLowercaseColumn(columnName: string) {
    const operation = buildLowercaseOperation(columnName);
    toggleOperation(operation, `Added lowercase for ${columnName}.`, `Removed lowercase for ${columnName}.`);
  }

  function toggleConvertType(columnName: string, targetType: "numeric" | "datetime") {
    const operation = buildConvertTypeOperation(columnName, targetType);
    toggleOperation(
      operation,
      `Added: convert "${columnName}" to ${targetType}.`,
      `Removed convert "${columnName}" from the queue.`,
    );
  }

  async function handleApplyCleaning() {
    if (!workspace || !token || cleaningOperations.length === 0) {
      setFeedback("Add at least one cleaning operation before applying changes.", "warning");
      return;
    }

    setApplying(true);
    setFeedback("");

    try {
      const response = await applyCleaningOperations(workspace.dataset.id, cleaningOperations, token, getSourceVersionId());
      setCleaningDetection(response);
      setCleaningResult(response);
      setFeedback("Cleaning applied. Review the preview before saving.", "success");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not apply cleaning operations.", "error");
    } finally {
      setApplying(false);
    }
  }

  async function handleSaveResult() {
    if (!workspace || !token) {
      return;
    }

    if (saveMode === "new" && !newDatasetName.trim()) {
      setFeedback("Please enter a dataset name.", "warning");
      return;
    }

    const resultSnapshot = cleaningResult?.data_snapshot ?? buildSnapshotFromDataset(workspace.dataset);

    setSaving(true);
    setFeedback("");

    try {
      const response = await saveDatasetResult(
        workspace.dataset.id,
        {
          replace_current: saveMode === "replace",
          dataset_name: newDatasetName.trim() || null,
          description: workspace.dataset.description,
          data_snapshot: resultSnapshot,
        },
        token,
      );

      setShowSaveModal(false);

      if (saveMode === "replace") {
        setWorkspace({
          ...workspace,
          dataset: response.dataset,
        });
        setFeedback("Result replaced the current dataset.", "success");
      } else {
        setFeedback("Result saved as a new dataset.", "success");
        router.replace(`/dataset/${response.dataset.id}`);
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not save result.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleExportResult() {
    if (!workspace || !token) {
      return;
    }

    setExporting(true);
    setFeedback("");

    try {
      // Prefer exporting the most recent unsaved session result when available.
      const sessionSnapshot = (cleaningResult?.data_snapshot ?? null) as Record<string, unknown> | null;
      const { blob, filename } = await exportDataset(
        workspace.dataset.id,
        { format: exportFormat, data_snapshot: sessionSnapshot },
        token,
      );

      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);

      setFeedback("Export started.", "success");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not export dataset.", "error");
    } finally {
      setExporting(false);
    }
  }

  async function handleGenerateAggregation() {
    if (!workspace || !token) return;
    setGroupLoading(true);
    setFeedback("");
    try {
      const result = await groupDataset(
        workspace.dataset.id,
        { group_by: aggregationGroupBy, aggregate_column: aggregateColumn, aggregate_func: aggregationOperation },
        token,
      );
      setGroupResult(result);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not generate aggregation.", "error");
    } finally {
      setGroupLoading(false);
    }
  }

  function handleExportGroupCSV() {
    if (!groupResult) return;
    const opLabel = aggregationOperation === "mean" ? "Average" : aggregationOperation.charAt(0).toUpperCase() + aggregationOperation.slice(1);
    const header = `"${groupResult.group_by}","${opLabel} of ${groupResult.aggregate_column}"`;
    const rows = groupResult.results.map((r) => `"${String(r.group).replace(/"/g, '""')}",${r.value}`);
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${groupResult.group_by}_${aggregationOperation}_${groupResult.aggregate_column}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSaveGroupAsDataset() {
    if (!groupResult || !token) return;
    const name = saveGroupAsName.trim() || `${groupResult.group_by} ${aggregationOperation} ${groupResult.aggregate_column}`;
    const opLabel = aggregationOperation === "mean" ? "Average" : aggregationOperation.charAt(0).toUpperCase() + aggregationOperation.slice(1);
    const header = `"${groupResult.group_by}","${opLabel} of ${groupResult.aggregate_column}"`;
    const rows = groupResult.results.map((r) => `"${String(r.group).replace(/"/g, '""')}",${r.value}`);
    const csv = [header, ...rows].join("\n");
    const file = new File([csv], `${name}.csv`, { type: "text/csv" });
    setSaveGroupAsSaving(true);
    try {
      await uploadDataset(file, `Aggregation: ${opLabel} of ${groupResult.aggregate_column} grouped by ${groupResult.group_by}`, token);
      setFeedback(`Saved "${name}" as a new dataset.`, "success");
      setSaveGroupAsOpen(false);
      setSaveGroupAsName("");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not save dataset.", "error");
    } finally {
      setSaveGroupAsSaving(false);
    }
  }

  async function handleRunPrediction() {
    if (!workspace || !token) return;
    setPredictionLoading(true);
    setFeedback("");
    try {
      const result = await predictDataset(
        workspace.dataset.id,
        { input_column: predictionInputColumn, target_column: predictionTargetColumn, future_steps: predictionSteps },
        token,
      );
      setPredictionResult(result);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Could not run prediction.", "error");
    } finally {
      setPredictionLoading(false);
    }
  }

  function renderPreviewTable(previewRows: Array<Record<string, unknown>> = workspace?.dataset.preview_json ?? []) {
    if (previewRows.length === 0) {
      return <p className="text-sm text-slate-600">No preview available.</p>;
    }

    const columns = Object.keys(previewRows[0] ?? {});
    return (
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3 text-left font-medium text-slate-600">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {previewRows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column} className="px-4 py-3 text-slate-800">
                    {String((row as Record<string, unknown>)[column] ?? "-")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderCleaningTab() {
    if (cleaningDetecting) {
      return (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          Detecting cleaning issues...
        </div>
      );
    }

    const duplicateCount = cleaningDetection?.duplicates ?? 0;
    const missingIssues = cleaningIssues.filter((issue) => issue.kind === "missing_values" && issue.column);
    const textColumns = getTextColumns(cleaningDetection, availableColumns);
    const duplicateOperation = buildDuplicateOperation();
    const trimWhitespaceOperation = buildTrimWhitespaceOperation(textColumns);
    const duplicateQueued = hasQueuedOperation(duplicateOperation);
    const trimQueued = hasQueuedOperation(trimWhitespaceOperation);
    const originalRows = workspace?.dataset.row_count;
    const afterCleaningRows = cleaningResult?.summary.row_count ?? originalRows;
    const rowsRemoved = typeof originalRows === "number" && typeof afterCleaningRows === "number" ? Math.max(originalRows - afterCleaningRows, 0) : 0;

    return (
      <div className="space-y-6">
        {message ? <div className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${getFeedbackClasses(messageTone)}`}>{message}</div> : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Original Rows</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{workspace?.dataset.row_count ?? "-"}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">After Cleaning</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{String(cleaningResult?.summary.row_count ?? workspace?.dataset.row_count ?? "-")}</p>
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

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                    <h3 className="text-lg font-semibold text-slate-950">Duplicate Rows</h3>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{duplicateCount > 0 ? `${duplicateCount} duplicate rows found.` : "No duplicates detected right now."}</p>
                </div>
                <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                  {duplicateCount > 0 ? `${duplicateCount} found` : "Clear"}
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="font-medium text-slate-950">Remove duplicate rows</p>
                  <p className="text-sm text-slate-600">Keep one copy of each repeated record.</p>
                </div>
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${duplicateQueued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-red-600 text-white hover:bg-red-500"}`}
                  onClick={toggleDuplicateRows}
                >
                  {duplicateQueued ? "Added" : "Add"}
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-yellow-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
                    <h3 className="text-lg font-semibold text-slate-950">Missing Values</h3>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">Choose a simple fix for each affected column.</p>
                </div>
                <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-700">
                  {missingIssues.length > 0 ? `${missingIssues.length} columns` : "None detected"}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {missingIssues.length > 0 ? (
                  missingIssues.map((issue) => {
                    const columnName = issue.column ?? "";
                    const columnType = getColumnType(columnName, cleaningDetection);
                    const selectedStrategy = missingValueStrategies[columnName] ?? getDefaultMissingStrategy(columnName, cleaningDetection);
                    const operation = buildMissingValueOperation(columnName, selectedStrategy);
                    const queued = hasQueuedOperation(operation);
                    const missingCount = Number(issue.details?.missing_values ?? 0);
                    const rowCount = Number(workspace?.dataset.row_count ?? 0);
                    const percentage = rowCount > 0 ? ((missingCount / rowCount) * 100).toFixed(1) : "0.0";

                    return (
                      <div key={columnName} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-slate-950">Column: {columnName}</p>
                            <p className="mt-1 text-sm text-slate-600">{missingCount} missing values ({percentage}%)</p>
                          </div>
                          <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-700">{columnType}</span>
                        </div>

                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                          <select
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none sm:max-w-xs"
                            value={selectedStrategy}
                            onChange={(event) =>
                              setMissingValueStrategies((currentStrategies) => ({
                                ...currentStrategies,
                                [columnName]: event.target.value as MissingStrategy,
                              }))
                            }
                          >
                            <option value="fill_mean">Fill with average</option>
                            <option value="fill_median">Fill with median</option>
                            <option value="fill_mode">Fill with mode</option>
                            <option value="drop_rows">Drop rows</option>
                          </select>

                          <button
                            type="button"
                            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${queued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-indigo-600 text-white hover:bg-indigo-500"}`}
                            onClick={() => addMissingValueOperation(columnName)}
                          >
                            {queued ? "Added" : "Add"}
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                    No missing-value issues detected.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-orange-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
                    <h3 className="text-lg font-semibold text-slate-950">Text Standardization</h3>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">Quick cleanup for text-heavy columns.</p>
                </div>
                <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
                  {textColumns.length > 0 ? `${textColumns.length} columns` : "No text columns"}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div>
                    <p className="font-medium text-slate-950">Trim whitespace</p>
                    <p className="text-sm text-slate-600">Remove leading and trailing spaces from text columns.</p>
                  </div>
                  <button
                    type="button"
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${trimQueued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-indigo-600 text-white hover:bg-indigo-500"}`}
                    onClick={toggleTrimWhitespace}
                    disabled={textColumns.length === 0}
                  >
                    {trimQueued ? "Added" : "Add"}
                  </button>
                </div>

                <div className="space-y-2">
                  {textColumns.length > 0 ? (
                    textColumns.map((columnName) => {
                      const columnType = getColumnType(columnName, cleaningDetection);
                      if (!isLowercaseCandidate(columnType)) {
                        return null;
                      }

                      const operation = buildLowercaseOperation(columnName);
                      const queued = hasQueuedOperation(operation);

                      return (
                        <div key={columnName} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div>
                            <p className="font-medium text-slate-950">Lowercase {columnName}</p>
                            <p className="text-sm text-slate-600">Make text consistent.</p>
                          </div>
                          <button
                            type="button"
                            className={`rounded-full px-4 py-2 text-sm font-medium transition ${queued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-indigo-600 text-white hover:bg-indigo-500"}`}
                            onClick={() => toggleLowercaseColumn(columnName)}
                          >
                            {queued ? "Added" : "Add"}
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                      No text columns were detected for standardization.
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-purple-200 bg-white p-5 shadow-sm">
              {(() => {
                const typeIssues = cleaningIssues.filter((issue) => issue.kind === "type_inconsistency" && issue.column);
                return (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full bg-purple-500" />
                          <h3 className="text-lg font-semibold text-slate-950">Type Inconsistencies</h3>
                        </div>
                        <p className="mt-1 text-sm text-slate-600">Columns stored as the wrong data type. Converting allows aggregation and analysis.</p>
                      </div>
                      <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-semibold text-purple-700">
                        {typeIssues.length > 0 ? `${typeIssues.length} column${typeIssues.length !== 1 ? "s" : ""}` : "None detected"}
                      </span>
                    </div>

                    <div className="mt-4 space-y-3">
                      {typeIssues.length > 0 ? (
                        typeIssues.map((issue) => {
                          const columnName = issue.column ?? "";
                          const inferredType = String(issue.details?.inferred_type ?? "");
                          const targetType: "numeric" | "datetime" = inferredType === "datetime_string" ? "datetime" : "numeric";
                          const operation = buildConvertTypeOperation(columnName, targetType);
                          const queued = hasQueuedOperation(operation);

                          return (
                            <div key={columnName} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                              <div>
                                <p className="font-medium text-slate-950">Column: {columnName}</p>
                                <p className="mt-1 text-sm text-slate-600">
                                  Stored as text — looks like{" "}
                                  <span className="font-medium text-purple-700">{targetType}</span>.
                                  Non-convertible values will become empty.
                                </p>
                              </div>
                              <button
                                type="button"
                                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${queued ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-purple-600 text-white hover:bg-purple-500"}`}
                                onClick={() => toggleConvertType(columnName, targetType)}
                              >
                                {queued ? "Added" : `Convert to ${targetType}`}
                              </button>
                            </div>
                          );
                        })
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                          No type inconsistencies detected.
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">Outliers</h3>
                  <p className="text-sm text-slate-600">Optional for now. This section is ready for future numeric checks.</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">Coming soon</span>
              </div>
            </section>
          </div>

          <aside className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-18 h-fit">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">Selected Operations</h3>
                <p className="text-sm text-slate-600">Review the queue before applying.</p>
              </div>
              <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">{cleaningOperations.length}</span>
            </div>

            <div className="space-y-3">
              {cleaningOperations.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                  No operations selected yet.
                </div>
              ) : (
                cleaningOperations.map((operation, index) => (
                  <div key={`${operation.operation_type}-${index}`} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm shadow-sm">
                    <div>
                      <p className="font-medium text-slate-950">{getOperationLabel(operation)}</p>
                      <p className="mt-1 text-xs text-slate-500">{getOperationDetail(operation)}</p>
                    </div>
                    <button
                      type="button"
                      className="rounded-full px-2 py-1 text-sm font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-700"
                      onClick={() => setCleaningOperations((currentOperations) => currentOperations.filter((_, operationIndex) => operationIndex !== index))}
                      aria-label={`Remove ${getOperationLabel(operation)}`}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            <button
              type="button"
              className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
              onClick={handleApplyCleaning}
              disabled={applying || cleaningOperations.length === 0}
            >
              {applying ? "Applying..." : `Apply ${cleaningOperations.length} Operation${cleaningOperations.length === 1 ? "" : "s"}`}
            </button>
          </aside>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="font-semibold text-slate-950">Cleaned Preview</h3>
            <p className="mt-1 text-sm text-slate-600">Preview the result before saving a new version.</p>
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
              {cleaningResult ? renderPreviewTable(cleaningResult.preview) : <p className="text-sm text-slate-600">No cleaned preview yet.</p>}
            </div>
            {cleaningResult ? (
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <dt className="text-slate-500">Rows</dt>
                    <dd className="font-medium text-slate-950">{String(cleaningResult.summary.row_count ?? "-")}</dd>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <dt className="text-slate-500">Columns</dt>
                  <dd className="font-medium text-slate-950">{String(cleaningResult.summary.column_count ?? "-")}</dd>
                </div>
                <div className={`rounded-xl border p-3 ${getFeedbackClasses(Number(cleaningResult.summary.missing_cells ?? 0) > 0 ? "warning" : "success")}`}>
                  <dt className="text-slate-500">Missing</dt>
                  <dd className="font-medium">{String(cleaningResult.summary.missing_cells ?? "-")}</dd>
                </div>
                <div className={`rounded-xl border p-3 ${getFeedbackClasses(Number(cleaningResult.summary.duplicate_rows ?? 0) > 0 ? "error" : "success")}`}>
                  <dt className="text-slate-500">Duplicates</dt>
                  <dd className="font-medium">{String(cleaningResult.summary.duplicate_rows ?? "-")}</dd>
                </div>
              </dl>
            ) : null}
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="font-semibold text-slate-950">Save Result</h3>
            <p className="text-sm text-slate-600">Choose whether to replace the current dataset or create a new one.</p>
            <button
              type="button"
              className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={saving || !cleaningResult}
              onClick={() => setShowSaveModal(true)}
            >
              Save Result
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderTabContent() {
    if (!workspace) {
      return null;
    }

    if (activeTab === "overview") {
      return (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">Rows</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">{workspace.dataset.row_count ?? "-"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">Columns</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">{workspace.dataset.column_count ?? "-"}</p>
            </div>
            <div className={`rounded-2xl border p-4 shadow-sm ${getSummaryTone("Missing cells", workspace.dataset.summary_json?.missing_cells as number | string | null | undefined)}`}>
              <p className="text-sm text-slate-500">Missing cells</p>
              <p className="mt-1 text-2xl font-semibold">{String(workspace.dataset.summary_json?.missing_cells ?? "-")}</p>
            </div>
            <div className={`rounded-2xl border p-4 shadow-sm ${getSummaryTone("Duplicates", workspace.dataset.summary_json?.duplicate_rows as number | string | null | undefined)}`}>
              <p className="text-sm text-slate-500">Duplicates</p>
              <p className="mt-1 text-2xl font-semibold">{String(workspace.dataset.summary_json?.duplicate_rows ?? "-")}</p>
            </div>
          </div>
          {renderPreviewTable()}
        </div>
      );
    }

    if (activeTab === "cleaning") {
      return renderCleaningTab();
    }

    if (activeTab === "analysis") {
      if (analysisLoading) {
        return <p className="text-sm text-slate-600">Loading column statistics...</p>;
      }

      const stats = analysisStats;
      const numericCols = stats?.column_stats.filter((c) => c.dtype === "numeric") ?? [];
      const colsWithMissing = stats?.column_stats.filter((c) => c.missing > 0) ?? [];
      const mostMissingCol = colsWithMissing.sort((a, b) => b.missing_pct - a.missing_pct)[0] ?? null;

      return (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">Total rows</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">{stats?.row_count ?? workspace.dataset.row_count ?? "-"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">Total columns</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">{stats?.col_count ?? workspace.dataset.column_count ?? "-"}</p>
            </div>
            <div className={`rounded-2xl border p-4 shadow-sm ${colsWithMissing.length > 0 ? "border-yellow-200 bg-yellow-50 text-yellow-800" : "border-green-200 bg-green-50 text-green-800"}`}>
              <p className="text-sm text-slate-500">Columns with missing</p>
              <p className="mt-1 text-2xl font-semibold">{stats ? colsWithMissing.length : "-"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">Numeric columns</p>
              <p className="mt-1 text-2xl font-semibold text-indigo-600">{stats ? numericCols.length : "-"}</p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-950">Column summaries</h3>
              {stats ? (
                <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Column</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">Non-null</th>
                        <th className="px-4 py-3 font-medium">Missing %</th>
                        <th className="px-4 py-3 font-medium">Unique</th>
                        <th className="px-4 py-3 font-medium">Mean / Min / Max</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                      {stats.column_stats.map((col) => (
                        <tr key={col.name}>
                          <td className="px-4 py-3 font-medium text-slate-950">{col.name}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              col.dtype === "numeric" ? "bg-indigo-100 text-indigo-700" :
                              col.dtype === "datetime" ? "bg-purple-100 text-purple-700" :
                              col.dtype === "boolean" ? "bg-orange-100 text-orange-700" :
                              "bg-slate-100 text-slate-600"
                            }`}>
                              {col.dtype}
                            </span>
                          </td>
                          <td className="px-4 py-3">{col.count}</td>
                          <td className={`px-4 py-3 font-medium ${col.missing_pct > 0 ? "text-yellow-700" : "text-green-700"}`}>
                            {col.missing_pct > 0 ? `${col.missing_pct}%` : "—"}
                          </td>
                          <td className="px-4 py-3">{col.unique}</td>
                          <td className="px-4 py-3 text-slate-500">
                            {col.dtype === "numeric" && col.mean != null
                              ? `${col.mean} / ${col.min ?? "?"} / ${col.max ?? "?"}`
                              : col.top_values[0] != null
                              ? String(col.top_values[0].value)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-600">Switch to this tab to load statistics.</p>
              )}
            </div>

            <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-950">Insights</h3>
              {stats ? (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-800">
                    {numericCols.length > 0
                      ? `${numericCols.length} numeric column${numericCols.length === 1 ? "" : "s"} detected. Use the Aggregation tab to summarize them.`
                      : "No numeric columns detected in this dataset."}
                  </div>
                  {colsWithMissing.length > 0 ? (
                    <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
                      {colsWithMissing.length} column{colsWithMissing.length === 1 ? "" : "s"} have missing values.
                      {mostMissingCol ? ` Highest: "${mostMissingCol.name}" (${mostMissingCol.missing_pct}%).` : ""}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                      No missing values detected across all columns.
                    </div>
                  )}
                  {(workspace.dataset.summary_json?.duplicate_rows as number) > 0 ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                      {String(workspace.dataset.summary_json?.duplicate_rows)} duplicate rows found. Clean them in the Cleaning tab.
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-600">Insights will appear once statistics are loaded.</p>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (activeTab === "aggregation") {
      return (
        <div className="space-y-6">
          {message ? <div className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${getFeedbackClasses(messageTone)}`}>{message}</div> : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="mb-2 block text-sm font-medium text-slate-900">Group by</span>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                value={aggregationGroupBy}
                onChange={(event) => setAggregationGroupBy(event.target.value)}
              >
                {availableColumns.map((columnName) => (
                  <option key={columnName} value={columnName}>
                    {columnName}
                  </option>
                ))}
              </select>
            </label>

            <label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="mb-2 block text-sm font-medium text-slate-900">Aggregate column</span>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                value={aggregateColumn}
                onChange={(event) => setAggregateColumn(event.target.value)}
              >
                {availableColumns.map((columnName) => (
                  <option key={columnName} value={columnName}>
                    {columnName}
                  </option>
                ))}
              </select>
            </label>

            <label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="mb-2 block text-sm font-medium text-slate-900">Function</span>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                value={aggregationOperation}
                onChange={(event) => setAggregationOperation(event.target.value)}
              >
                <option value="sum">Sum</option>
                <option value="mean">Average (mean)</option>
                <option value="count">Count</option>
                <option value="min">Min</option>
                <option value="max">Max</option>
              </select>
            </label>

            <div className="flex items-end rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <button
                type="button"
                className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
                onClick={handleGenerateAggregation}
                disabled={groupLoading || availableColumns.length === 0}
              >
                {groupLoading ? "Generating..." : "Generate result"}
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-950">Result table</h3>
            {groupResult ? (
              <p className="mt-1 text-sm text-slate-600">
                {aggregationOperation === "mean" ? "Average" : aggregationOperation.charAt(0).toUpperCase() + aggregationOperation.slice(1)} of <strong>{groupResult.aggregate_column}</strong> grouped by <strong>{groupResult.group_by}</strong> — {groupResult.results.length} groups, sorted by value.
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-600">Choose columns and a function, then click Generate result.</p>
            )}
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
              {groupResult && groupResult.results.length > 0 ? (
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-slate-600">{groupResult.group_by}</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-600">
                        {aggregationOperation === "mean" ? "Average" : aggregationOperation.charAt(0).toUpperCase() + aggregationOperation.slice(1)} of {groupResult.aggregate_column}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {groupResult.results.map((row, index) => (
                      <tr key={index}>
                        <td className="px-4 py-3 font-medium text-slate-950">{row.group}</td>
                        <td className="px-4 py-3 text-slate-800">{row.value.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-6 text-sm text-slate-600">
                  {groupResult ? "No groups found in the selected column." : "Results will appear here after you generate."}
                </div>
              )}
            </div>

            {groupResult && groupResult.results.length > 0 && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleExportGroupCSV}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSaveGroupAsOpen((v) => !v); setSaveGroupAsName(""); }}
                    className="rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
                  >
                    Save as new dataset
                  </button>
                </div>

                {saveGroupAsOpen && (
                  <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
                    <p className="mb-3 text-sm font-medium text-slate-800">Save aggregation as a new dataset</p>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        placeholder={`${groupResult.group_by} ${aggregationOperation} ${groupResult.aggregate_column}`}
                        value={saveGroupAsName}
                        onChange={(e) => setSaveGroupAsName(e.target.value)}
                        className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleSaveGroupAsDataset}
                        disabled={saveGroupAsSaving}
                        className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-70"
                      >
                        {saveGroupAsSaving ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSaveGroupAsOpen(false)}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Leave the name blank to use the default. The dataset will appear in your dashboard.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === "trends") {
      if (trendLoading) return <p className="text-sm text-slate-600">Loading trend analysis...</p>;

      const numericCols = trendData?.columns ?? [];
      const activeTrend = numericCols.find((c) => c.column === selectedTrendColumn) ?? numericCols[0] ?? null;

      function directionBadge(dir: string) {
        const map: Record<string, string> = {
          increasing: "bg-green-100 text-green-700",
          decreasing: "bg-red-100 text-red-700",
          stable: "bg-yellow-100 text-yellow-700",
          volatile: "bg-orange-100 text-orange-700",
        };
        return map[dir] ?? "bg-slate-100 text-slate-600";
      }

      function renderTrendChart(trend: typeof activeTrend) {
        if (!trend || trend.chart_points.length < 2) {
          return <p className="text-sm text-slate-500">Not enough data points to render chart.</p>;
        }
        const W = 560;
        const H = 180;
        const PAD = 32;
        const pts = trend.chart_points;
        const minY = Math.min(...pts.map((p) => p.y));
        const maxY = Math.max(...pts.map((p) => p.y));
        const rangeY = maxY - minY || 1;
        const maxX = pts[pts.length - 1]?.x ?? 1;

        function px(p: { x: number; y: number }) {
          return {
            cx: PAD + (p.x / maxX) * (W - 2 * PAD),
            cy: H - PAD - ((p.y - minY) / rangeY) * (H - 2 * PAD),
          };
        }

        const tl = trend.trend_line;
        const tl0 = px(tl[0]!);
        const tl1 = px(tl[1]!);
        const isUp = trend.direction === "increasing";

        return (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
            <polyline
              points={pts.map((p) => { const { cx, cy } = px(p); return `${cx.toFixed(1)},${cy.toFixed(1)}`; }).join(" ")}
              fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round"
            />
            <line
              x1={tl0.cx} y1={tl0.cy} x2={tl1.cx} y2={tl1.cy}
              stroke={isUp ? "#22c55e" : "#ef4444"} strokeWidth="1.5" strokeDasharray="6 4"
            />
            <text x={PAD} y={PAD - 8} fontSize="10" fill="#94a3b8">{maxY.toFixed(1)}</text>
            <text x={PAD} y={H - PAD + 14} fontSize="10" fill="#94a3b8">{minY.toFixed(1)}</text>
          </svg>
        );
      }

      return (
        <div className="space-y-6">
          {numericCols.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
              No numeric columns found. Upload a dataset with numeric data to see trends.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-900">Column</span>
                  <select
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                    value={selectedTrendColumn}
                    onChange={(e) => setSelectedTrendColumn(e.target.value)}
                  >
                    {numericCols.map((c) => (
                      <option key={c.column} value={c.column}>{c.column}</option>
                    ))}
                  </select>
                </label>
                {activeTrend ? (
                  <span className={`mt-5 rounded-full px-3 py-1 text-xs font-semibold capitalize ${directionBadge(activeTrend.direction)}`}>
                    {activeTrend.direction}
                  </span>
                ) : null}
              </div>

              {activeTrend ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
                    {[
                      { label: "Min", value: activeTrend.min },
                      { label: "Max", value: activeTrend.max },
                      { label: "Mean", value: activeTrend.mean },
                      { label: "Slope", value: activeTrend.slope },
                      { label: "R²", value: activeTrend.r_squared },
                      { label: "Points", value: activeTrend.count },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="text-sm text-slate-500">{label}</p>
                        <p className="mt-1 text-lg font-semibold text-slate-950">{String(value)}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-sm font-semibold text-slate-950 mb-3">
                      Trend chart — <span className="text-indigo-600">{activeTrend.column}</span>
                      <span className="ml-2 text-xs text-slate-400">(blue = data, dashed = trend line)</span>
                    </h3>
                    {renderTrendChart(activeTrend)}
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      );
    }

    if (activeTab === "anomaly") {
      if (anomalyLoading) return <p className="text-sm text-slate-600">Running anomaly detection...</p>;

      const anomaly = anomalyData;

      return (
        <div className="space-y-6">
          {!anomaly ? (
            <p className="text-sm text-slate-600">Switch to this tab to run anomaly detection.</p>
          ) : anomaly.columns_analyzed === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
              No numeric columns found. Anomaly detection requires at least one numeric column.
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm text-slate-500">Columns analyzed</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950">{anomaly.columns_analyzed}</p>
                </div>
                <div className={`rounded-2xl border p-4 shadow-sm ${anomaly.total_flagged_rows > 0 ? "border-orange-200 bg-orange-50" : "border-green-200 bg-green-50"}`}>
                  <p className="text-sm text-slate-500">Total flagged rows</p>
                  <p className={`mt-1 text-2xl font-semibold ${anomaly.total_flagged_rows > 0 ? "text-orange-700" : "text-green-700"}`}>{anomaly.total_flagged_rows}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm text-slate-500">Columns with outliers</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950">{anomaly.columns.filter((c) => c.outlier_count > 0).length}</p>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-950">Outliers per column</h3>
                <p className="mt-1 text-sm text-slate-600">IQR method — values outside [Q1 − 1.5·IQR, Q3 + 1.5·IQR] are flagged.</p>

                <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Column</th>
                        <th className="px-4 py-3 font-medium">Outliers</th>
                        <th className="px-4 py-3 font-medium">%</th>
                        <th className="px-4 py-3 font-medium">Lower fence</th>
                        <th className="px-4 py-3 font-medium">Upper fence</th>
                        <th className="px-4 py-3 font-medium">Samples</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {anomaly.columns.map((col) => (
                        <tr key={col.column}>
                          <td className="px-4 py-3 font-medium text-slate-950">{col.column}</td>
                          <td className="px-4 py-3">
                            <span className={col.outlier_count > 0 ? "font-semibold text-orange-700" : "text-slate-400"}>{col.outlier_count}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={`h-full rounded-full ${col.outlier_pct > 10 ? "bg-red-500" : col.outlier_pct > 3 ? "bg-orange-400" : "bg-yellow-400"}`}
                                  style={{ width: `${Math.min(col.outlier_pct, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-slate-500">{col.outlier_pct}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{col.lower_fence}</td>
                          <td className="px-4 py-3 text-slate-600">{col.upper_fence}</td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{col.sample_outliers.slice(0, 3).map(String).join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      );
    }

    if (activeTab === "prediction") {
      function getPredictionConfidence(rSquared: number): { label: "High" | "Medium" | "Low"; badgeClasses: string } {
        if (rSquared >= 0.7) return { label: "High", badgeClasses: "bg-green-100 text-green-700" };
        if (rSquared >= 0.4) return { label: "Medium", badgeClasses: "bg-yellow-100 text-yellow-700" };
        return { label: "Low", badgeClasses: "bg-red-100 text-red-700" };
      }

      function getPredictionTrend(slope: number): { label: "Trending Up" | "Trending Down" | "Stable"; badgeClasses: string } {
        if (slope > 0.01) return { label: "Trending Up", badgeClasses: "bg-green-100 text-green-700" };
        if (slope < -0.01) return { label: "Trending Down", badgeClasses: "bg-red-100 text-red-700" };
        return { label: "Stable", badgeClasses: "bg-slate-100 text-slate-600" };
      }

      const W = 560, H = 140, PAD = 32;
      let chartEl: React.ReactNode = null;
      if (predictionResult && predictionResult.predictions.length > 0) {
        const pts = predictionResult.predictions;
        const allY = pts.flatMap((p) => [p.lower_bound, p.upper_bound]);
        const yMin = Math.min(...allY);
        const yMax = Math.max(...allY);
        const yRange = yMax - yMin || 1;
        const px = (i: number) => PAD + (i / (pts.length - 1 || 1)) * (W - PAD * 2);
        const py = (v: number) => PAD + (1 - (v - yMin) / yRange) * (H - PAD * 2);

        const bandPoints = [
          ...pts.map((p, i) => `${px(i)},${py(p.upper_bound)}`),
          ...[...pts].reverse().map((p, i) => `${px(pts.length - 1 - i)},${py(p.lower_bound)}`),
        ].join(" ");
        const linePoints = pts.map((p, i) => `${px(i)},${py(p.predicted_value)}`).join(" ");

        chartEl = (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }}>
            <polygon points={bandPoints} fill="#6366f1" fillOpacity={0.12} />
            <polyline points={linePoints} fill="none" stroke="#6366f1" strokeWidth={2} strokeLinejoin="round" />
            {pts.map((p, i) => (
              <circle key={i} cx={px(i)} cy={py(p.predicted_value)} r={3} fill="#6366f1" />
            ))}
          </svg>
        );
      }

      return (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="mb-1 block text-sm font-medium text-slate-900">Time / label column</span>
              <span className="mb-2 block text-xs text-slate-400">(optional — used to label the x-axis)</span>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                value={predictionInputColumn}
                onChange={(event) => setPredictionInputColumn(event.target.value)}
              >
                {availableColumns.map((columnName) => (
                  <option key={columnName} value={columnName}>{columnName}</option>
                ))}
              </select>
            </label>

            <label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="mb-2 block text-sm font-medium text-slate-900">Column to forecast</span>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                value={predictionTargetColumn}
                onChange={(event) => setPredictionTargetColumn(event.target.value)}
              >
                {availableColumns.map((columnName) => (
                  <option key={columnName} value={columnName}>{columnName}</option>
                ))}
              </select>
            </label>

            <label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="mb-2 block text-sm font-medium text-slate-900">Steps ahead</span>
              <input
                type="number"
                min={1}
                max={20}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                value={predictionSteps}
                onChange={(e) => setPredictionSteps(Math.max(1, Math.min(20, Number(e.target.value))))}
              />
            </label>

            <div className="flex items-end rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <button
                type="button"
                className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-70"
                onClick={handleRunPrediction}
                disabled={predictionLoading}
              >
                {predictionLoading ? "Running..." : "Run prediction"}
              </button>
            </div>
          </div>

          {predictionResult && (() => {
            const lastPrediction = predictionResult.predictions[predictionResult.predictions.length - 1];
            const lastValue = lastPrediction ? lastPrediction.predicted_value : null;
            const confidence = getPredictionConfidence(predictionResult.r_squared);
            const trend = getPredictionTrend(predictionResult.slope);
            return (
              <div className="rounded-3xl border border-indigo-200 bg-indigo-50/60 p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${trend.badgeClasses}`}>{trend.label}</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${confidence.badgeClasses}`}>{confidence.label} confidence</span>
                </div>
                <p className="mt-3 text-sm text-slate-700">
                  If this continues,{" "}
                  <span className="font-semibold text-slate-950">{predictionResult.target_column}</span>{" "}
                  is expected to reach approximately{" "}
                  <span className="font-semibold text-indigo-700">
                    {lastValue !== null ? lastValue.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"}
                  </span>{" "}
                  in <span className="font-semibold text-slate-950">{predictionResult.future_steps}</span>{" "}
                  {predictionResult.future_steps === 1 ? "step" : "steps"}.
                </p>
              </div>
            );
          })()}

          {predictionResult && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-950">Forecast — {predictionResult.target_column}</h3>
                <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Period</th>
                        <th className="px-4 py-3 font-medium">Expected</th>
                        <th className="px-4 py-3 font-medium">Est. Range</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {predictionResult.predictions.map((p) => (
                        <tr key={p.step}>
                          <td className="px-4 py-3 font-medium text-slate-700">Period {p.step}</td>
                          <td className="px-4 py-3 font-semibold text-indigo-700">
                            {p.predicted_value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {p.lower_bound.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                            {" – "}
                            {p.upper_bound.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {chartEl && (
                  <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                    {chartEl}
                  </div>
                )}
              </div>

              {(() => {
                const confidence = getPredictionConfidence(predictionResult.r_squared);
                const slopeAbs = Math.abs(predictionResult.slope);
                const slopeSign = predictionResult.slope >= 0 ? "+" : "−";
                return (
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-950">Model</h3>
                    <div className="mt-4 space-y-3 text-sm text-slate-700">
                      <div className="flex justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <span className="text-slate-500">Trend rate</span>
                        <span className={`font-semibold ${predictionResult.slope >= 0 ? "text-green-700" : "text-red-700"}`}>
                          {slopeSign}{slopeAbs.toFixed(1)} per period
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <span className="text-slate-500">Forecast confidence</span>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${confidence.badgeClasses}`}>
                          {confidence.label}
                        </span>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                        Forecast uses a linear trend model. Accuracy improves with more data.
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {!predictionResult && !predictionLoading && (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              Choose a column to forecast and the number of steps ahead, then click <span className="font-medium text-slate-700">Run prediction</span>.
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">This tab is ready for more demo content.</div>
    );
  }

  if (loading) {
    return <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">Loading workspace...</main>;
  }

  if (!workspace) {
    return null;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500">Dataset workspace</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{workspace.dataset.original_filename}</h1>
              <p className="text-sm text-slate-600">Workspace for previewing, cleaning, analyzing, and saving results.</p>
            </div>
            <Link className="text-sm font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-4" href="/dashboard">
              Back to dashboard
            </Link>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-4">
              {(["overview", "cleaning", "analysis", "aggregation", "trends", "anomaly", "prediction"] as WorkspaceTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    activeTab === tab ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <div className="mt-6">{renderTabContent()}</div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">Current result</h2>
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm">
                  <p className="font-medium text-slate-950">Ready to save</p>
                  <p className="mt-1 text-slate-600">Use the save button to keep the current result or make a new dataset.</p>
                </div>
                <div className="rounded-2xl border border-green-100 bg-green-50 p-4 text-sm text-green-800">
                  <p className="font-medium">Result summary</p>
                  <p className="mt-1">Rows: {String(cleaningResult?.summary.row_count ?? workspace.dataset.row_count ?? "-")}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                  <p className="font-medium text-slate-950">Dataset name</p>
                  <p className="mt-1">{workspace.dataset.original_filename}</p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">Export</h2>
              <p className="mt-1 text-sm text-slate-600">Download the current result as CSV, Excel, or JSON.</p>

              <div className="mt-4 grid gap-3">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-900">Format</span>
                  <select
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500"
                    value={exportFormat}
                    onChange={(event) => setExportFormat(event.target.value as ExportDatasetFormat)}
                    disabled={exporting}
                  >
                    <option value="csv">CSV</option>
                    <option value="xlsx">XLSX</option>
                    <option value="json">JSON</option>
                  </select>
                </label>

                <button
                  type="button"
                  className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
                  onClick={handleExportResult}
                  disabled={exporting}
                >
                  {exporting ? "Exporting..." : "Export"}
                </button>
              </div>
            </div>
          </aside>
        </section>

        {showSaveModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
            <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-900/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500">Save Result</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Choose how to save</h2>
                </div>
                <button type="button" className="rounded-full px-3 py-1 text-2xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" onClick={() => setShowSaveModal(false)}>
                  ×
                </button>
              </div>

              <div className="mt-6 space-y-3">
                <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${saveMode === "replace" ? "border-indigo-200 bg-indigo-50" : "border-slate-200 bg-white"}`}>
                  <input className="mt-1 h-4 w-4 accent-indigo-600" type="radio" checked={saveMode === "replace"} onChange={() => setSaveMode("replace")} />
                  <div>
                    <p className="font-medium text-slate-950">Replace current dataset</p>
                    <p className="mt-1 text-sm text-slate-600">Keep the same dataset and update it with this result.</p>
                  </div>
                </label>

                <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${saveMode === "new" ? "border-indigo-200 bg-indigo-50" : "border-slate-200 bg-white"}`}>
                  <input className="mt-1 h-4 w-4 accent-indigo-600" type="radio" checked={saveMode === "new"} onChange={() => setSaveMode("new")} />
                  <div className="w-full">
                    <p className="font-medium text-slate-950">Save as new dataset</p>
                    <p className="mt-1 text-sm text-slate-600">Create a separate dataset from this result.</p>

                    {saveMode === "new" ? (
                      <label className="mt-4 block">
                        <span className="mb-2 block text-sm font-medium text-slate-900">Dataset Name</span>
                        <input
                          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500"
                          value={newDatasetName}
                          onChange={(event) => setNewDatasetName(event.target.value)}
                          placeholder="Enter a dataset name"
                          required
                        />
                      </label>
                    ) : null}
                  </div>
                </label>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button type="button" className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50" onClick={() => setShowSaveModal(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
                  onClick={handleSaveResult}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
