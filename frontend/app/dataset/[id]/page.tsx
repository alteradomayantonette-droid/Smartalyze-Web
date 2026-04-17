"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  applyCleaningOperations,
  CleaningIssue,
  CleaningOperation,
  CleanApplyResponse,
  CleanDetectResponse,
  createDatasetVersion,
  DatasetWorkspace,
  detectCleaningIssues,
  getDatasetWorkspace,
} from "@/lib/api";
import { clearStoredToken, getStoredToken } from "@/lib/auth";

type WorkspaceTab = "overview" | "cleaning" | "analysis" | "aggregation" | "prediction";
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

function getIssueTone(kind: string): { border: string; background: string; label: string; badge: string } {
  if (kind === "duplicates") {
    return {
      border: "border-red-200",
      background: "bg-red-50",
      label: "text-red-700",
      badge: "bg-red-100 text-red-700",
    };
  }

  if (kind === "type_inconsistency") {
    return {
      border: "border-orange-200",
      background: "bg-orange-50",
      label: "text-orange-700",
      badge: "bg-orange-100 text-orange-700",
    };
  }

  return {
    border: "border-yellow-200",
    background: "bg-yellow-50",
    label: "text-yellow-800",
    badge: "bg-yellow-100 text-yellow-700",
  };
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

export default function DatasetWorkspacePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const datasetId = Number(params.id);

  const [workspace, setWorkspace] = useState<DatasetWorkspace | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [token, setToken] = useState<string | null>(null);
  const [operationType, setOperationType] = useState("cleaned");
  const [replaceCurrent, setReplaceCurrent] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<FeedbackTone>("neutral");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [cleaningDetection, setCleaningDetection] = useState<CleanDetectResponse | null>(null);
  const [cleaningIssues, setCleaningIssues] = useState<CleaningIssue[]>([]);
  const [cleaningOperations, setCleaningOperations] = useState<CleaningOperation[]>([]);
  const [cleaningResult, setCleaningResult] = useState<CleanApplyResponse | null>(null);
  const [missingValueStrategies, setMissingValueStrategies] = useState<Record<string, MissingStrategy>>({});

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
      .then(setWorkspace)
      .catch(() => {
        clearStoredToken();
        router.replace("/login");
      })
      .finally(() => setLoading(false));
  }, [datasetId, router]);

  const availableColumns = workspace?.dataset.columns_json?.map((column) => String(column.name ?? "")).filter(Boolean) ?? [];

  function getSourceVersionId(): number | null {
    return workspace?.dataset.current_version_id ?? workspace?.versions.at(-1)?.id ?? null;
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

  async function handleDetectCleaning() {
    if (!workspace || !token) {
      return;
    }

    setDetecting(true);
    setFeedback("");

    try {
      const response = await detectCleaningIssues(workspace.dataset.id, token, getSourceVersionId());
      setCleaningDetection(response);
      setCleaningIssues(response.issues);
      setFeedback(`Detected ${response.issues.length} issue(s).`, "success");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not detect cleaning issues.", "error");
    } finally {
      setDetecting(false);
    }
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
      setCleaningIssues(response.issues);
      setFeedback("Cleaning applied. Review the preview before saving.", "success");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not apply cleaning operations.", "error");
    } finally {
      setApplying(false);
    }
  }

  async function handleSaveVersion() {
    if (!workspace || !token) {
      return;
    }

    setSaving(true);
    setFeedback("");

    try {
      const version = await createDatasetVersion(
        workspace.dataset.id,
        {
          operation_type: operationType,
          replace_current: replaceCurrent,
          data_snapshot: cleaningResult?.data_snapshot ?? null,
        },
        token,
      );

      setWorkspace({
        ...workspace,
        dataset:
          replaceCurrent && cleaningResult
            ? {
                ...workspace.dataset,
                current_version_id: version.id,
                row_count: Number(cleaningResult.summary.row_count ?? workspace.dataset.row_count),
                column_count: Number(cleaningResult.summary.column_count ?? workspace.dataset.column_count),
                preview_json: cleaningResult.preview,
                summary_json: cleaningResult.summary,
                size_bytes: Number(cleaningResult.summary.size_bytes ?? workspace.dataset.size_bytes),
              }
            : workspace.dataset,
        versions: [...workspace.versions, version].sort((left, right) => left.version_number - right.version_number),
      });
      setFeedback("Version saved.", "success");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not save version.", "error");
    } finally {
      setSaving(false);
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
                            <p className="font-medium text-slate-950">Lowercase "{columnName}"</p>
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

          <aside className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-6 h-fit">
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
            <h3 className="font-semibold text-slate-950">Save Version</h3>
            <p className="text-sm text-slate-600">Save the cleaned result as a new dataset version.</p>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-900">Operation type</span>
              <input
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-indigo-500"
                value={operationType}
                onChange={(event) => setOperationType(event.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={replaceCurrent} onChange={(event) => setReplaceCurrent(event.target.checked)} />
              Replace current dataset preview with this result
            </label>
            <button
              type="button"
              className="w-full rounded-xl border border-green-200 bg-green-50 px-4 py-3 font-medium text-green-700 transition hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={saving}
              onClick={handleSaveVersion}
            >
              {saving ? "Saving..." : "Save as new version"}
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

    const descriptions: Record<Exclude<WorkspaceTab, "overview">, string> = {
      cleaning: "Detect missing values, duplicates, and type issues here. The result can be saved as a new version.",
      analysis: "Show summary statistics, distributions, and data quality insights here.",
      aggregation: "Group by categorical columns and compute sums, averages, counts, and min/max values.",
      prediction: "Use a simple linear regression flow for controlled, explainable prediction.",
    };

    if (activeTab === "cleaning") {
      return renderCleaningTab();
    }

    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
        {descriptions[activeTab as Exclude<WorkspaceTab, "overview">]}
      </div>
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
              <p className="text-sm text-slate-600">Versioned workspace for previewing, cleaning, analyzing, and exporting data.</p>
            </div>
            <Link className="text-sm font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-4" href="/dashboard">
              Back to dashboard
            </Link>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-4">
              {(["overview", "cleaning", "analysis", "aggregation", "prediction"] as WorkspaceTab[]).map((tab) => (
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
            {activeTab !== "cleaning" ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-950">Save result</h2>
                <p className="mt-1 text-sm text-slate-600">Use this after an action to create a new version of the current dataset.</p>
                <label className="mt-4 block">
                  <span className="mb-2 block text-sm font-medium text-slate-900">Operation type</span>
                  <input
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none transition focus:border-indigo-500"
                    value={operationType}
                    onChange={(event) => setOperationType(event.target.value)}
                  />
                </label>
                <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={replaceCurrent} onChange={(event) => setReplaceCurrent(event.target.checked)} />
                  Replace current dataset preview with this result
                </label>
                <button
                  type="button"
                  className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={saving}
                  onClick={handleSaveVersion}
                >
                  {saving ? "Saving..." : "Save as new version"}
                </button>
                {message ? <p className={`mt-3 rounded-xl border px-3 py-2 text-sm ${getFeedbackClasses(messageTone)}`}>{message}</p> : null}
              </div>
            ) : null}

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">Versions</h2>
              <div className="mt-4 space-y-3">
                {workspace.versions.map((version) => (
                  <div key={version.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-950">Version {version.version_number}</span>
                      <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs uppercase tracking-[0.2em] text-indigo-700">{version.operation_type}</span>
                    </div>
                    <p className="mt-2 text-slate-600">{new Date(version.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">Next actions</h2>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <p>1. Save the result as a new dataset.</p>
                <p>2. Save the result as a new version.</p>
                <p>3. Replace the current dataset.</p>
                <p>4. Export the result as CSV or insights.</p>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
