"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  applyCleaningOperations,
  CleaningIssue,
  CleaningOperation,
  CleanDetectResponse,
  CleanApplyResponse,
  detectCleaningIssues,
  createDatasetVersion,
  DatasetWorkspace,
  getDatasetWorkspace,
} from "@/lib/api";
import { clearStoredToken, getStoredToken } from "@/lib/auth";

type WorkspaceTab = "overview" | "cleaning" | "analysis" | "aggregation" | "prediction";

type SuggestedCleaningAction = {
  label: string;
  description: string;
  operation: CleaningOperation;
};

function formatIssueTitle(issue: CleaningIssue): string {
  if (issue.kind === "duplicates") {
    return "Duplicate rows detected";
  }

  if (issue.kind === "missing_values") {
    return issue.column ? `Missing values in ${issue.column}` : "Missing values detected";
  }

  if (issue.kind === "type_inconsistency") {
    if (issue.column) {
      return `${issue.column} needs a type fix`;
    }
    return "Type issue detected";
  }

  return issue.message;
}

function describeSeverity(severity: CleaningIssue["severity"]): string {
  if (severity === "error") {
    return "High priority";
  }

  if (severity === "warning") {
    return "Recommended";
  }

  return "Optional";
}

function buildSuggestedCleaningAction(
  issue: CleaningIssue,
  detection: CleanDetectResponse | null,
): SuggestedCleaningAction | null {
  if (issue.kind === "duplicates") {
    return {
      label: "Remove duplicates",
      description: "Remove duplicate rows before saving or exporting.",
      operation: {
        operation_type: "remove_all_duplicates",
        columns: [],
        column: null,
        target_type: null,
        drop_all_missing: true,
        errors: "coerce",
      },
    };
  }

  if (issue.kind === "missing_values" && issue.column) {
    const columnType = detection?.column_types?.[issue.column] ?? "unknown";
    const shouldUseMedian = columnType === "numeric" || columnType === "numeric_string";
    return {
      label: shouldUseMedian ? "Fill missing values with median" : "Fill missing values with most common value",
      description: shouldUseMedian
        ? `Use the median for ${issue.column} to keep the data balanced.`
        : `Use the most common value for ${issue.column} to keep the column complete.`,
      operation: {
        operation_type: shouldUseMedian ? "fill_median" : "fill_mode",
        columns: [issue.column],
        column: issue.column,
        target_type: null,
        drop_all_missing: true,
        errors: "coerce",
      },
    };
  }

  if (issue.kind === "type_inconsistency" && issue.column) {
    const inferredType = String(issue.details?.inferred_type ?? detection?.column_types?.[issue.column] ?? "");
    const targetType = inferredType === "datetime_string" ? "datetime" : "numeric";
    return {
      label: targetType === "datetime" ? "Convert to date format" : "Convert to numeric",
      description: targetType === "datetime"
        ? `Turn ${issue.column} into a proper date field.`
        : `Turn ${issue.column} into a proper numeric field.`,
      operation: {
        operation_type: "convert_column_type",
        columns: [issue.column],
        column: issue.column,
        target_type: targetType,
        drop_all_missing: true,
        errors: "coerce",
      },
    };
  }

  return null;
}

function describeCleaningOperation(operation: CleaningOperation): { title: string; detail: string } {
  switch (operation.operation_type) {
    case "fill_mean":
      return {
        title: "Fill missing values with average",
        detail: `Columns: ${operation.columns?.join(", ") ?? "-"}`,
      };
    case "fill_median":
      return {
        title: "Fill missing values with median",
        detail: `Columns: ${operation.columns?.join(", ") ?? "-"}`,
      };
    case "fill_mode":
      return {
        title: "Fill missing values with most common value",
        detail: `Columns: ${operation.columns?.join(", ") ?? "-"}`,
      };
    case "drop_rows":
      return {
        title: "Drop rows with missing values",
        detail: `Columns: ${operation.columns?.join(", ") ?? "-"}`,
      };
    case "remove_all_duplicates":
      return {
        title: "Remove duplicate rows",
        detail: "Applies to the full dataset.",
      };
    case "convert_column_type":
      return {
        title: operation.target_type === "datetime" ? "Convert to date format" : "Convert to numeric",
        detail: `Column: ${operation.column ?? "-"}`,
      };
    default:
      return {
        title: "Cleaning action",
        detail: `Columns: ${operation.columns?.join(", ") ?? "-"}`,
      };
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [cleaningDetection, setCleaningDetection] = useState<CleanDetectResponse | null>(null);
  const [cleaningIssues, setCleaningIssues] = useState<CleaningIssue[]>([]);
  const [cleaningOperations, setCleaningOperations] = useState<CleaningOperation[]>([]);
  const [cleaningResult, setCleaningResult] = useState<CleanApplyResponse | null>(null);
  const [operationDraftType, setOperationDraftType] = useState<CleaningOperation["operation_type"]>("fill_mode");
  const [operationDraftColumns, setOperationDraftColumns] = useState("");
  const [operationDraftColumn, setOperationDraftColumn] = useState("");
  const [operationDraftTargetType, setOperationDraftTargetType] = useState<NonNullable<CleaningOperation["target_type"]>>("numeric");
  const [operationDraftDropAllMissing, setOperationDraftDropAllMissing] = useState(true);
  const [operationDraftErrors, setOperationDraftErrors] = useState<NonNullable<CleaningOperation["errors"]>>("coerce");

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

  async function handleDetectCleaning() {
    if (!workspace || !token) {
      return;
    }

    setDetecting(true);
    setMessage("");

    try {
      const response = await detectCleaningIssues(
        workspace.dataset.id,
        token,
        getSourceVersionId(),
      );
      setCleaningDetection(response);
      setCleaningIssues(response.issues);
      setMessage(`Detected ${response.issues.length} issue(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not detect cleaning issues.");
    } finally {
      setDetecting(false);
    }
  }

  async function handleApplyCleaning() {
    if (!workspace || !token || cleaningOperations.length === 0) {
      setMessage("Add at least one cleaning operation before applying changes.");
      return;
    }

    setApplying(true);
    setMessage("");

    try {
      const response = await applyCleaningOperations(
        workspace.dataset.id,
        cleaningOperations,
        token,
        getSourceVersionId(),
      );
      setCleaningDetection(response);
      setCleaningResult(response);
      setCleaningIssues(response.issues);
      setMessage("Cleaning applied. Review the preview before saving.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not apply cleaning operations.");
    } finally {
      setApplying(false);
    }
  }

  async function handleSaveVersion() {
    if (!workspace || !token) {
      return;
    }

    setSaving(true);
    setMessage("");

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
        dataset: replaceCurrent && cleaningResult
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
      setMessage("Version saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save version.");
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

  function addCleaningOperation() {
    const columns = operationDraftColumns
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);

    const operation: CleaningOperation = {
      operation_type: operationDraftType,
      columns: operationDraftType === "remove_all_duplicates" ? [] : columns,
      column: operationDraftColumn.trim() || null,
      target_type: operationDraftType === "convert_column_type" ? operationDraftTargetType : null,
      drop_all_missing: operationDraftDropAllMissing,
      errors: operationDraftErrors,
    };

    if (operation.operation_type === "convert_column_type" && !operation.column) {
      setMessage("Choose a column for type conversion.");
      return;
    }

    if ((operation.operation_type === "fill_mean" || operation.operation_type === "fill_median" || operation.operation_type === "fill_mode" || operation.operation_type === "drop_rows") && columns.length === 0) {
      setMessage("Add at least one column for this cleaning action.");
      return;
    }

    setCleaningOperations((currentOperations) => [...currentOperations, operation]);
    setMessage("Cleaning operation added.");
  }

  function removeCleaningOperation(index: number) {
    setCleaningOperations((currentOperations) => currentOperations.filter((_, operationIndex) => operationIndex !== index));
  }

  function queueCleaningOperation(operation: CleaningOperation, successMessage: string) {
    setCleaningOperations((currentOperations) => {
      const exists = currentOperations.some((currentOperation) => areCleaningOperationsEqual(currentOperation, operation));
      if (exists) {
        return currentOperations;
      }

      return [...currentOperations, operation];
    });
    setMessage(successMessage);
  }

  function addSuggestedCleaningAction(issue: CleaningIssue) {
    const suggestedAction = buildSuggestedCleaningAction(issue, cleaningDetection);

    if (!suggestedAction) {
      setMessage("No suggestion is available for this issue yet.");
      return;
    }

    queueCleaningOperation(suggestedAction.operation, `Added suggestion: ${suggestedAction.label}`);
  }

  function applyAllSuggestions() {
    if (cleaningIssues.length === 0) {
      setMessage("Run issue detection first.");
      return;
    }

    const suggestedOperations = cleaningIssues
      .map((issue) => buildSuggestedCleaningAction(issue, cleaningDetection)?.operation)
      .filter((operation): operation is CleaningOperation => Boolean(operation));

    if (suggestedOperations.length === 0) {
      setMessage("No suggestions are available for the detected issues.");
      return;
    }

    setCleaningOperations((currentOperations) => {
      const mergedOperations = [...currentOperations];

      suggestedOperations.forEach((operation) => {
        const exists = mergedOperations.some((currentOperation) => areCleaningOperationsEqual(currentOperation, operation));
        if (!exists) {
          mergedOperations.push(operation);
        }
      });

      return mergedOperations;
    });

    setMessage("Added all suggestions to the cleaning queue.");
  }

  function renderCleaningTab() {
    const detectedIssues = cleaningIssues.length > 0 ? cleaningIssues : [];
    const suggestedIssues = detectedIssues
      .map((issue) => ({ issue, suggestion: buildSuggestedCleaningAction(issue, cleaningDetection) }))
      .filter((entry): entry is { issue: CleaningIssue; suggestion: SuggestedCleaningAction } => Boolean(entry.suggestion));

    return (
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Suggested fixes</h3>
                <p className="text-sm text-slate-600">Detect issues, then click a suggestion to add it to the queue.</p>
              </div>
              <button
                type="button"
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                onClick={handleDetectCleaning}
                disabled={detecting}
              >
                {detecting ? "Detecting..." : "Detect issues"}
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Active version</p>
                <p className="font-medium">{getSourceVersionId() ?? "Latest"}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Queued operations</p>
                <p className="font-medium">{cleaningOperations.length}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Detected issues</p>
                <p className="font-medium">{detectedIssues.length}</p>
              </div>
            </div>

            {detectedIssues.length > 0 ? (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <p className="font-medium text-slate-900">Suggested actions</p>
                    <p className="text-sm text-slate-600">Add every recommended fix to the queue with one click.</p>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                    onClick={applyAllSuggestions}
                    disabled={suggestedIssues.length === 0}
                  >
                    Apply All Suggestions
                  </button>
                </div>

                {suggestedIssues.map(({ issue, suggestion }, index) => {
                  const hasColumn = issue.column ? `Column: ${issue.column}` : null;
                  const title = formatIssueTitle(issue);

                  return (
                    <article key={`${issue.kind}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-500">{describeSeverity(issue.severity)}</p>
                          <h4 className="mt-1 text-base font-semibold text-slate-950">{title}</h4>
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                          {issue.severity}
                        </span>
                      </div>

                      <p className="mt-3 text-sm leading-6 text-slate-700">{issue.message}</p>
                      <p className="mt-2 text-sm text-slate-600">Suggestion: {suggestion.description}</p>

                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        {hasColumn ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                            {hasColumn}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                          onClick={() => addSuggestedCleaningAction(issue)}
                        >
                          Apply Suggestion
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600">Run detection to review missing values, duplicates, and type issues.</p>
            )}
          </div>

          <details className="rounded-2xl border border-slate-200 p-4">
            <summary className="cursor-pointer list-none font-semibold">Advanced Cleaning (Optional)</summary>
            <p className="mt-1 text-sm text-slate-600">Power users can still build custom cleaning actions here.</p>

            <div className="mt-4 space-y-3 text-sm">
              <label className="block">
                <span className="mb-2 block font-medium">Action type</span>
                <select
                  className="w-full rounded-xl border border-slate-300 px-3 py-2"
                  value={operationDraftType}
                  onChange={(event) => setOperationDraftType(event.target.value as CleaningOperation["operation_type"])}
                >
                  <option value="fill_mean">Fill missing values with average</option>
                  <option value="fill_median">Fill missing values with median</option>
                  <option value="fill_mode">Fill missing values with most common value</option>
                  <option value="drop_rows">Drop rows with missing values</option>
                  <option value="remove_all_duplicates">Remove duplicate rows</option>
                  <option value="convert_column_type">Convert column type</option>
                </select>
              </label>

              {operationDraftType === "convert_column_type" ? (
                <label className="block">
                  <span className="mb-2 block font-medium">Column</span>
                  <input
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                    value={operationDraftColumn}
                    onChange={(event) => setOperationDraftColumn(event.target.value)}
                    placeholder="column name"
                  />
                </label>
              ) : null}

              {operationDraftType !== "remove_all_duplicates" ? (
                <label className="block">
                  <span className="mb-2 block font-medium">Columns</span>
                  <input
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                    value={operationDraftColumns}
                    onChange={(event) => setOperationDraftColumns(event.target.value)}
                    placeholder="comma-separated column names"
                  />
                </label>
              ) : null}

              {operationDraftType === "convert_column_type" ? (
                <label className="block">
                  <span className="mb-2 block font-medium">Target type</span>
                  <select
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                    value={operationDraftTargetType}
                    onChange={(event) => setOperationDraftTargetType(event.target.value as NonNullable<CleaningOperation["target_type"]>)}
                  >
                    <option value="numeric">Numeric</option>
                    <option value="string">String</option>
                    <option value="datetime">Datetime</option>
                    <option value="categorical">Categorical</option>
                    <option value="boolean">Boolean</option>
                  </select>
                </label>
              ) : null}

              {operationDraftType === "drop_rows" ? (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={operationDraftDropAllMissing}
                    onChange={(event) => setOperationDraftDropAllMissing(event.target.checked)}
                  />
                  Drop rows with any missing value
                </label>
              ) : null}

              {operationDraftType === "convert_column_type" ? (
                <label className="block">
                  <span className="mb-2 block font-medium">Conversion mode</span>
                  <select
                    className="w-full rounded-xl border border-slate-300 px-3 py-2"
                    value={operationDraftErrors}
                    onChange={(event) => setOperationDraftErrors(event.target.value as NonNullable<CleaningOperation["errors"]>)}
                  >
                    <option value="coerce">Coerce invalid values</option>
                    <option value="raise">Raise error</option>
                    <option value="ignore">Ignore invalid values</option>
                  </select>
                </label>
              ) : null}

              {availableColumns.length > 0 ? (
                <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                  Available columns: {availableColumns.join(", ")}
                </div>
              ) : null}

              <button
                type="button"
                className="w-full rounded-xl border border-slate-300 px-4 py-2 font-medium transition hover:bg-slate-50"
                onClick={addCleaningOperation}
              >
                Add to queue
              </button>
            </div>
          </details>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Queued operations</h3>
                <p className="text-sm text-slate-600">These actions will be applied in order.</p>
              </div>
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                onClick={handleApplyCleaning}
                disabled={applying || cleaningOperations.length === 0}
              >
                {applying ? "Applying..." : "Apply cleaning"}
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {cleaningOperations.length === 0 ? (
                <p className="text-sm text-slate-600">No operations queued yet.</p>
              ) : (
                cleaningOperations.map((operation, index) => (
                  <div key={`${operation.operation_type}-${index}`} className="rounded-xl border border-slate-200 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{describeCleaningOperation(operation).title}</p>
                      <button
                        type="button"
                        className="text-xs font-medium text-red-600"
                        onClick={() => removeCleaningOperation(index)}
                      >
                        Remove
                      </button>
                    </div>
                    <p className="mt-2 text-slate-600">{describeCleaningOperation(operation).detail}</p>
                    {operation.target_type ? <p className="mt-2 text-slate-600">Target: {operation.target_type}</p> : null}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <h3 className="font-semibold">Cleaned preview</h3>
            <p className="mt-1 text-sm text-slate-600">Apply operations to preview the transformed dataset before saving.</p>
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
              {cleaningResult ? renderPreviewTable(cleaningResult.preview) : <p className="text-sm text-slate-600">No cleaned preview yet.</p>}
            </div>
            {cleaningResult ? (
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">Rows</dt>
                  <dd className="font-medium">{String(cleaningResult.summary.row_count ?? "-")}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Columns</dt>
                  <dd className="font-medium">{String(cleaningResult.summary.column_count ?? "-")}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Missing</dt>
                  <dd className="font-medium">{String(cleaningResult.summary.missing_cells ?? "-")}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Duplicates</dt>
                  <dd className="font-medium">{String(cleaningResult.summary.duplicate_rows ?? "-")}</dd>
                </div>
              </dl>
            ) : null}
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
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">Rows</p>
              <p className="mt-1 text-2xl font-semibold">{workspace.dataset.row_count ?? "-"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">Columns</p>
              <p className="mt-1 text-2xl font-semibold">{workspace.dataset.column_count ?? "-"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500">Missing cells</p>
              <p className="mt-1 text-2xl font-semibold">{String(workspace.dataset.summary_json?.missing_cells ?? "-")}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
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
    return <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900">Loading workspace...</main>;
  }

  if (!workspace) {
    return null;
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Dataset workspace</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{workspace.dataset.original_filename}</h1>
              <p className="text-sm text-slate-600">Versioned workspace for previewing, cleaning, analyzing, and exporting data.</p>
            </div>
            <Link className="text-sm font-medium text-slate-900 underline" href="/dashboard">
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
                    activeTab === tab ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
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
              <h2 className="text-lg font-semibold">Save result</h2>
              <p className="mt-1 text-sm text-slate-600">Use this after an action to create a new version of the current dataset.</p>
              <label className="mt-4 block">
                <span className="mb-2 block text-sm font-medium">Operation type</span>
                <input
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-slate-900"
                  value={operationType}
                  onChange={(event) => setOperationType(event.target.value)}
                />
              </label>
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={replaceCurrent}
                  onChange={(event) => setReplaceCurrent(event.target.checked)}
                />
                Replace current dataset preview with this result
              </label>
              <button
                type="button"
                className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={saving}
                onClick={handleSaveVersion}
              >
                {saving ? "Saving..." : "Save as new version"}
              </button>
              {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Versions</h2>
              <div className="mt-4 space-y-3">
                {workspace.versions.map((version) => (
                  <div key={version.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">Version {version.version_number}</span>
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-500">{version.operation_type}</span>
                    </div>
                    <p className="mt-2 text-slate-600">{new Date(version.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Next actions</h2>
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
