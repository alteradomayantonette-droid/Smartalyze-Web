"use client";

import { CleanDetectResponse, DatasetWorkspace } from "@/lib/api";

interface OverviewTabProps {
  workspace: DatasetWorkspace;
  cleaningDetection: CleanDetectResponse | null;
  onNavigate: (tab: "prepare" | "explore" | "detect") => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function computeHealth(
  missingCells: number,
  duplicateRows: number,
  totalCells: number,
  rowCount: number,
): { score: number; color: string; label: string } {
  const missingRate = totalCells > 0 ? missingCells / totalCells : 0;
  const dupRate = rowCount > 0 ? duplicateRows / rowCount : 0;
  const score = Math.round((1 - missingRate) * 0.6 * 100 + (1 - dupRate) * 0.4 * 100);
  const color = score >= 80 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  const label = score >= 80 ? "Good" : score >= 50 ? "Fair" : "Needs Work";
  return { score, color, label };
}

function TypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; classes: string }> = {
    numeric: { label: "Numeric", classes: "bg-blue-100 text-blue-700" },
    numeric_string: { label: "Numeric", classes: "bg-blue-100 text-blue-700" },
    text: { label: "Text", classes: "bg-slate-100 text-slate-600" },
    categorical: { label: "Category", classes: "bg-violet-100 text-violet-700" },
    datetime: { label: "Date/Time", classes: "bg-amber-100 text-amber-700" },
    datetime_string: { label: "Date/Time", classes: "bg-amber-100 text-amber-700" },
    boolean: { label: "Boolean", classes: "bg-pink-100 text-pink-700" },
  };
  const info = config[type] ?? { label: type || "Unknown", classes: "bg-slate-100 text-slate-500" };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${info.classes}`}>{info.label}</span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const classes =
    severity === "critical" || severity === "error"
      ? "bg-red-100 text-red-700"
      : severity === "warning"
      ? "bg-amber-100 text-amber-700"
      : "bg-slate-100 text-slate-600";
  return (
    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold uppercase ${classes}`}>
      {severity}
    </span>
  );
}

export function OverviewTab({ workspace, cleaningDetection, onNavigate }: OverviewTabProps) {
  const { dataset } = workspace;
  const rowCount = dataset.row_count ?? 0;
  const colCount = dataset.column_count ?? 0;
  const summary = (dataset.summary_json ?? {}) as Record<string, unknown>;
  const missingCells = Number(summary.missing_cells ?? 0);
  const duplicateRows = Number(summary.duplicate_rows ?? 0);
  const totalCells = rowCount * (colCount || 1);

  const health = computeHealth(missingCells, duplicateRows, totalCells, rowCount);
  const ringRadius = 38;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDashOffset = ringCircumference - (health.score / 100) * ringCircumference;

  const columns = (dataset.columns_json ?? []) as Array<Record<string, unknown>>;
  const preview = (dataset.preview_json ?? []) as Array<Record<string, unknown>>;
  const colNames = columns.map((c) => String(c.name ?? "")).filter(Boolean);

  const uniqueCounts: Record<string, number> = {};
  colNames.forEach((col) => {
    const seen = new Set<unknown>();
    preview.forEach((row) => {
      const val = row[col];
      if (val !== null && val !== undefined && val !== "") seen.add(val);
    });
    uniqueCounts[col] = seen.size;
  });

  function getFirstValue(col: string): string {
    for (const row of preview) {
      const val = row[col];
      if (val !== null && val !== undefined && val !== "") return String(val);
    }
    return "—";
  }

  function getCompleteness(col: string): number {
    if (rowCount === 0) return 100;
    const missing = cleaningDetection?.missing_values?.[col] ?? 0;
    return Math.max(0, Math.round(((rowCount - missing) / rowCount) * 100));
  }

  function getColType(col: string, rawType: string): string {
    return cleaningDetection?.column_types?.[col] ?? rawType;
  }

  const overallCompleteness = totalCells > 0 ? Math.round(((totalCells - missingCells) / totalCells) * 100) : 100;
  const issues = (cleaningDetection?.issues ?? []) as Array<Record<string, unknown>>;
  const topIssues = issues.slice(0, 6);

  const kpiTiles = [
    { title: "Total Rows", value: rowCount.toLocaleString(), accent: "bg-indigo-500", border: "border-indigo-100" },
    { title: "Total Columns", value: String(colCount), accent: "bg-sky-500", border: "border-sky-100" },
    { title: "Completeness", value: `${overallCompleteness}%`, accent: "bg-emerald-500", border: "border-emerald-100" },
    { title: "Duplicate Rows", value: duplicateRows.toLocaleString(), accent: "bg-red-400", border: "border-red-100" },
    { title: "Missing Cells", value: missingCells.toLocaleString(), accent: "bg-amber-400", border: "border-amber-100" },
    { title: "File Size", value: formatBytes(dataset.size_bytes), accent: "bg-purple-400", border: "border-purple-100" },
  ];

  const actionCards = [
    {
      tab: "prepare" as const,
      icon: "🧹",
      title: "Clean Data",
      desc: "Fix missing values, remove duplicates, standardize formats, and apply smart fills.",
      color: "border-indigo-200 hover:bg-indigo-50",
      badge: issues.length > 0 ? `${issues.length} issue${issues.length !== 1 ? "s" : ""}` : null,
      badgeClass: "bg-red-100 text-red-600",
    },
    {
      tab: "explore" as const,
      icon: "📊",
      title: "Explore Patterns",
      desc: "Visualize distributions, group by category, and spot trends across your columns.",
      color: "border-sky-200 hover:bg-sky-50",
      badge: null,
      badgeClass: "",
    },
    {
      tab: "detect" as const,
      icon: "🔍",
      title: "Detect Anomalies",
      desc: "Find outliers, unusual rows, and measure correlations between numeric columns.",
      color: "border-purple-200 hover:bg-purple-50",
      badge: null,
      badgeClass: "",
    },
  ];

  return (
    <div className="flex flex-col gap-6">

      {/* Health Score + KPIs */}
      <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <svg width="110" height="110" viewBox="0 0 100 100" aria-label={`Health score: ${health.score}%`}>
            <circle cx="50" cy="50" r={ringRadius} fill="none" stroke="#f1f5f9" strokeWidth="9" />
            <circle
              cx="50"
              cy="50"
              r={ringRadius}
              fill="none"
              stroke={health.color}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={ringCircumference}
              strokeDashoffset={ringDashOffset}
              transform="rotate(-90 50 50)"
            />
            <text x="50" y="46" textAnchor="middle" fontSize="20" fontWeight="700" fill="#0f172a">
              {health.score}
            </text>
            <text x="50" y="60" textAnchor="middle" fontSize="9" fill="#94a3b8">
              / 100
            </text>
          </svg>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Dataset Health</p>
          <span
            className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
              health.score >= 80
                ? "bg-green-100 text-green-700"
                : health.score >= 50
                ? "bg-amber-100 text-amber-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {health.label}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {kpiTiles.map(({ title, value, accent, border }) => (
            <div key={title} className={`rounded-2xl border bg-white p-4 shadow-sm ${border}`}>
              <div className={`mb-2 h-1 w-8 rounded-full ${accent}`} />
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{title}</p>
              <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Column Overview Table */}
      {colNames.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Column Overview</h2>
            <p className="text-xs text-slate-500">
              {colNames.length} columns · completeness based on {rowCount.toLocaleString()} rows
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">Column</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-left font-medium min-w-36">Completeness</th>
                  <th className="px-4 py-3 text-left font-medium">Unique (sample)</th>
                  <th className="px-4 py-3 text-left font-medium">Sample value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 bg-white">
                {columns.map((col) => {
                  const name = String(col.name ?? "");
                  const rawType = String(col.data_type ?? "");
                  const colType = getColType(name, rawType);
                  const completeness = getCompleteness(name);
                  const completenessColor =
                    completeness >= 90 ? "#22c55e" : completeness >= 70 ? "#f59e0b" : "#ef4444";
                  return (
                    <tr key={name} className="transition-colors hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-medium text-slate-900">{name}</td>
                      <td className="px-4 py-3">
                        <TypeBadge type={colType} />
                      </td>
                      <td className="px-4 py-3 min-w-36">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-slate-700">{completeness}%</span>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${completeness}%`, backgroundColor: completenessColor }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {uniqueCounts[name] ?? "—"}{preview.length < rowCount ? "+" : ""}
                      </td>
                      <td className="max-w-32 px-4 py-3">
                        <span className="block truncate font-mono text-xs text-slate-500">
                          {getFirstValue(name)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Issues + Quick Actions */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Issues */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">Issues Found</h2>
          {!cleaningDetection ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
              <p className="text-xs text-slate-400">Running data scan…</p>
            </div>
          ) : topIssues.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <span className="text-3xl">✓</span>
              <p className="text-sm font-medium text-emerald-600">No issues detected</p>
              <p className="text-xs text-slate-400">Your dataset looks clean and well-structured.</p>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              <p className="mb-1 text-xs text-slate-500">
                {issues.length} issue{issues.length !== 1 ? "s" : ""} found
                {issues.length > 6 ? ` — top ${topIssues.length} shown` : ""}
              </p>
              {topIssues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                  <SeverityBadge severity={String(issue.severity ?? "info")} />
                  <p className="text-xs leading-relaxed text-slate-700">{String(issue.message ?? "")}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">What to do next</h2>
          <div className="flex flex-col gap-3">
            {actionCards.map(({ tab, icon, title, desc, color, badge, badgeClass }) => (
              <button
                key={tab}
                type="button"
                onClick={() => onNavigate(tab)}
                className={`flex items-start gap-3 rounded-xl border bg-white p-4 text-left transition-colors ${color}`}
              >
                <span className="mt-0.5 shrink-0 text-xl">{icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{title}</span>
                    {badge && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>{badge}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{desc}</p>
                </div>
                <span className="mt-0.5 shrink-0 text-slate-300">→</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Data Preview */}
      {preview.length > 0 && colNames.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Data Preview</h2>
            <p className="text-xs text-slate-500">
              Showing first {Math.min(preview.length, 8)} of {rowCount.toLocaleString()} rows
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-xs">
              <thead className="bg-slate-50">
                <tr>
                  {colNames.map((col) => (
                    <th
                      key={col}
                      className="whitespace-nowrap px-4 py-2.5 text-left font-semibold text-slate-500"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 bg-white">
                {preview.slice(0, 8).map((row, i) => (
                  <tr key={i} className="transition-colors hover:bg-slate-50/50">
                    {colNames.map((col) => {
                      const val = row[col];
                      const isEmpty = val === null || val === undefined || val === "";
                      return (
                        <td
                          key={col}
                          className={`whitespace-nowrap px-4 py-2 font-mono ${
                            isEmpty ? "italic text-slate-300" : "text-slate-700"
                          }`}
                        >
                          {isEmpty ? "null" : String(val)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
